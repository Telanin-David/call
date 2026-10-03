package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "time/tzdata" // time zone names work on servers without tzdata

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/telanin-david/call/services/api/internal/accounts"
	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/platform"
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

	mail, text, err := notifiers(cfg, logger)
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

	// Everything the web app calls. Webhooks will mount outside this group:
	// they check provider signatures instead of cookies.
	r.Group(func(r chi.Router) {
		r.Use(platform.RequireJSON)
		r.Use(sessions.Load)
		acct.Routes(r)
	})

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
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

// notifiers picks real senders when their keys are set. Without keys,
// development logs codes instead of sending them; production refuses to start.
func notifiers(cfg platform.Config, logger *slog.Logger) (notify.Mailer, notify.Texter, error) {
	var mail notify.Mailer = notify.Log{Logger: logger}
	var text notify.Texter = notify.Log{Logger: logger}
	if cfg.ResendAPIKey != "" {
		mail = notify.Resend{APIKey: cfg.ResendAPIKey, From: cfg.EmailFrom}
	} else if cfg.Production() {
		return nil, nil, errors.New("RESEND_API_KEY must be set in production")
	}
	if cfg.TermiiAPIKey != "" {
		text = notify.Termii{APIKey: cfg.TermiiAPIKey, SenderID: cfg.TermiiSenderID, BaseURL: cfg.TermiiBaseURL}
	} else if cfg.Production() {
		return nil, nil, errors.New("TERMII_API_KEY must be set in production")
	}
	return mail, text, nil
}
