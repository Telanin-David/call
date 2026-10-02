package main

import (
	"log/slog"
	"os"
)

// worker handles background jobs: CSV imports, renewals, transcripts, summaries, emails, cleanup.
func main() {
	slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.Info("worker process starting")
	// TODO D3+: River job queue
	select {}
}
