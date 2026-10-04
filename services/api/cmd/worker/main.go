package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/numbers"
	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

// renewEvery is how often due plan and number renewals are looked for.
// Renewals are idempotent, so running more than one worker is safe.
const renewEvery = time.Hour

// worker handles background jobs. Today: plan and number renewals. Later:
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

	slog.Info("worker started")
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
