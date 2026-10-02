package main

import (
	"log/slog"
	"os"
)

// dialer is the auto-dial and multi-dial engine process.
// It shares the same Go module as the api process.
func main() {
	slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.Info("dialer process starting")
	// TODO D4: auto-dial engine
	select {}
}
