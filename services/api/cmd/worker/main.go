package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/telanin-david/call/services/api/internal/kyc"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/numbers"
	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

// renewEvery is how often due plan and number renewals are looked for.
// Renewals are idempotent, so running more than one worker is safe.
const renewEvery = time.Hour

// idCheckEvery is how often ID checks whose callback never came are looked
// up at the provider.
const idCheckEvery = 5 * time.Minute

// worker handles background jobs. Today: plan and number renewals, and ID
// checks the provider never called back about. Later:
// transcripts, summaries, emails, cleanup.
func main() {
	cfg := platform.MustLoadConfig()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	db, err := platform.OpenDB(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("open db", "err", err)
		os.Exit(1)
	}
	defer db.Close()
	mail, _, err := notify.FromConfig(cfg, logger)
	if err != nil {
		slog.Error("notify", "err", err)
		os.Exit(1)
	}
	renewals := &plans.Service{DB: db, Mail: mail, Log: logger}
	numberRenewals := &numbers.Service{DB: db, Provider: telephony.NumbersFromConfig(cfg), Mail: mail, Log: logger}
	idChecks := &kyc.Service{DB: db, Provider: kyc.FromConfig(cfg), Mail: mail, Log: logger}

	slog.Info("worker started")
	if _, real := idChecks.Provider.(kyc.SmileID); real {
		go func() {
			t := time.NewTicker(idCheckEvery)
			defer t.Stop()
			for {
				if n, err := idChecks.CheckPending(ctx); err != nil {
					slog.Error("id checks", "err", err)
				} else if n > 0 {
					slog.Info("id checks", "looked_up", n)
				}
				select {
				case <-ctx.Done():
					return
				case <-t.C:
				}
			}
		}()
	}
	tick := time.NewTicker(renewEvery)
	defer tick.Stop()
	for {
		res, err := renewals.RenewDue(ctx, time.Now())
		if err != nil {
			slog.Error("renewals", "err", err)
		} else {
			slog.Info("renewals", "renewed", res.Renewed, "moved_down", res.MovedDown, "warned", res.Warned, "moved_to_free", res.MovedToFree)
		}
		if nres, err := numberRenewals.RenewDue(ctx, time.Now()); err != nil {
			slog.Error("number renewals", "err", err)
		} else {
			slog.Info("number renewals", "renewed", nres.Renewed, "warned", nres.Warned, "released", nres.Released)
		}
		select {
		case <-ctx.Done():
			slog.Info("worker stopped")
			return
		case <-tick.C:
		}
	}
}
