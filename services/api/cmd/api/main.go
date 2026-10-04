package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "time/tzdata" // time zone names work on servers without tzdata

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/telanin-david/call/services/api/internal/accounts"
	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/billing"
	"github.com/telanin-david/call/services/api/internal/calls"
	"github.com/telanin-david/call/services/api/internal/kyc"
	"github.com/telanin-david/call/services/api/internal/leads"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/numbers"
	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/recordings"
	"github.com/telanin-david/call/services/api/internal/scripts"
	"github.com/telanin-david/call/services/api/internal/storage"
	"github.com/telanin-david/call/services/api/internal/telephony"
	"github.com/telanin-david/call/services/api/internal/wallet"
)

func main() {
	cfg := platform.MustLoadConfig()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	db, err := platform.OpenDB(context.Background(), cfg.DatabaseURL)
	if err != nil {
		slog.Error("open db", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	cache, err := platform.OpenCache(cfg.CacheURL)
	if err != nil {
		slog.Error("open cache", "err", err)
		os.Exit(1)
	}
	defer cache.Close()

	mail, text, err := notify.FromConfig(cfg, logger)
	if err != nil {
		slog.Error("notify", "err", err)
		os.Exit(1)
	}
	hasher := auth.NewHasher(cfg.SessionKey)
	sessions := auth.Sessions{DB: db, Hasher: hasher, Secure: cfg.Production() || cfg.Env == "staging"}
	acct := &accounts.Service{
		DB: db, Sessions: sessions, Hasher: hasher, Mail: mail, Text: text,
		Limiter: platform.ValkeyLimiter{Client: cache}, WebURL: cfg.WebURL, Log: logger,
	}

	providers, charges, err := payments(cfg)
	if err != nil {
		slog.Error("payments", "err", err)
		os.Exit(1)
	}
	wal := &wallet.Service{DB: db, Providers: providers, Charges: charges, WebURL: cfg.WebURL, Log: logger}
	planSvc := &plans.Service{DB: db, Mail: mail, Log: logger}
	leadSvc := &leads.Service{DB: db, Log: logger}
	scriptSvc := &scripts.Service{DB: db, Log: logger}
	files := storage.FromConfig(cfg)
	callSvc := &calls.Service{DB: db, Provider: telephony.CallsFromConfig(cfg), Recording: files != nil, Log: logger}
	recSvc := &recordings.Service{DB: db, Provider: callSvc.Provider, Store: files, Log: logger}
	idSvc := &kyc.Service{DB: db, Provider: kyc.FromConfig(cfg), Mail: mail, Log: logger}
	numberSvc := &numbers.Service{DB: db, Provider: telephony.NumbersFromConfig(cfg), Mail: mail, Limiter: platform.ValkeyLimiter{Client: cache}, Log: logger}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(platform.CORS(cfg.WebOrigins))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		platform.JSON(w, http.StatusOK, map[string]string{
			"status":  "ok",
			"version": "0.1.0",
		})
	})

	// Provider webhooks: no cookie, no JSON rule; the provider's signature
	// is checked before anything else.
	wal.WebhookRoutes(r)
	callSvc.WebhookRoutes(r)
	idSvc.WebhookRoutes(r)

	// Everything the web app calls.
	r.Group(func(r chi.Router) {
		r.Use(platform.RequireJSON)
		r.Use(sessions.Load)
		acct.Routes(r)
		wal.Routes(r)
		planSvc.Routes(r)
		leadSvc.Routes(r)
		scriptSvc.Routes(r)
		numberSvc.Routes(r)
		callSvc.Routes(r)
		recSvc.Routes(r)
		idSvc.Routes(r)
		if cfg.Env == "development" {
			wal.DevRoutes(r)
			callSvc.DevRoutes(r)
			recSvc.DevRoutes(r)
			idSvc.DevRoutes(r)
		}
	})
	if cfg.Env == "development" {
		// The fake phone provider's own events (a recording saved after a
		// call) arrive as if they were webhooks.
		go callSvc.PlayFakeEvents(context.Background(), time.Second)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		// Lead files can take a while to arrive over a slow mobile connection.
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 90 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		slog.Info("api listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("listen", "err", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("shutdown", "err", err)
	}
	slog.Info("api stopped")
}

// payments picks the real payment providers when their keys are set. In
// development, missing keys mean fake providers (pay with POST
// /dev/topups/{reference}/pay); elsewhere, missing keys mean card top-ups
// are switched off for that provider's reps.
func payments(cfg platform.Config) (map[string]billing.Provider, map[string]wallet.Charge, error) {
	providers := map[string]billing.Provider{}
	charges := map[string]wallet.Charge{"stripe": {Currency: "USD", MinorPerUSD: 100}}

	rate, err := strconv.ParseInt(cfg.PaystackMinorPerUSD, 10, 64)
	if err != nil || rate <= 0 {
		return nil, nil, fmt.Errorf("PAYSTACK_MINOR_PER_USD must be a whole number above 0, got %q", cfg.PaystackMinorPerUSD)
	}
	charges["paystack"] = wallet.Charge{Currency: strings.ToUpper(cfg.PaystackCurrency), MinorPerUSD: rate}

	if cfg.PaystackSecretKey != "" {
		providers["paystack"] = billing.Paystack{SecretKey: cfg.PaystackSecretKey}
	} else if cfg.Env == "development" {
		providers["paystack"] = &billing.Fake{ProviderName: "paystack", Secret: cfg.SessionKey}
	}
	if cfg.StripeSecretKey != "" {
		if cfg.StripeWebhookSecret == "" {
			return nil, nil, errors.New("STRIPE_WEBHOOK_SECRET must be set with STRIPE_SECRET_KEY")
		}
		providers["stripe"] = billing.Stripe{SecretKey: cfg.StripeSecretKey, WebhookSecret: cfg.StripeWebhookSecret}
	} else if cfg.Env == "development" {
		providers["stripe"] = &billing.Fake{ProviderName: "stripe", Secret: cfg.SessionKey}
	}
	return providers, charges, nil
}
