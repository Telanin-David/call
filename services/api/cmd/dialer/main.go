package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/telanin-david/call/services/api/internal/calls"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

// tickEvery is how often live calls are checked. A call is warned 30
// seconds before its money runs out, so this must be well under that.
const tickEvery = 5 * time.Second

// dialer keeps live calls paid for: it tops up each call's hold a minute
// at a time, warns and ends calls when the balance runs out, and closes
// calls that never connected. Later (D4) it also runs auto-dial.
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
	svc := &calls.Service{DB: db, Provider: telephony.CallsFromConfig(cfg), Log: logger}

	slog.Info("dialer started")
	tick := time.NewTicker(tickEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("dialer stopped")
			return
		case <-tick.C:
		}
		res, err := svc.Tick(ctx)
		if err != nil {
			slog.Error("tick", "err", err)
		} else if res.Extended+res.Warned+res.Ended > 0 {
			slog.Info("tick", "extended", res.Extended, "warned", res.Warned, "ended", res.Ended)
		}
	}
}
