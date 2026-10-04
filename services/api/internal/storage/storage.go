// Package storage is the only code that talks to file storage (Cloudflare
// R2, or any S3-compatible store). Files are private: they are reached only
// through links that stop working after a few minutes. A local folder
// stands in for it in development and tests.
package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/telanin-david/call/services/api/internal/platform"
)

// Store keeps files.
type Store interface {
	// Put saves a file, replacing any file with the same key.
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	// Delete removes a file. Deleting one that isn't there is not an error.
	Delete(ctx context.Context, key string) error
	// Link is an address that works until now+ttl. With download set, the
	// browser saves the file under that name instead of playing it.
	Link(key string, ttl time.Duration, download string, now time.Time) (string, error)
}

var (
	// ErrBadKey is a key that isn't a plain relative path.
	ErrBadKey = errors.New("storage: bad key")
	// ErrProvider means the store failed or answered something unexpected.
	ErrProvider = errors.New("storage: provider error")
)

// FromConfig picks S3 when it is set up. Development without it keeps files
// in a folder on this machine, shared by the api and the worker; elsewhere it
// returns nil and recording is off until storage is set.
func FromConfig(cfg platform.Config) Store {
	if cfg.S3Endpoint != "" && cfg.S3Bucket != "" && cfg.S3AccessKey != "" && cfg.S3SecretKey != "" {
		return &S3{Endpoint: cfg.S3Endpoint, Bucket: cfg.S3Bucket, AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, Region: cfg.S3Region, PathStyle: true}
	}
	if cfg.Env == "development" {
		dir := cfg.DevFilesDir
		if dir == "" {
			dir = filepath.Join(os.TempDir(), "dialer-dev-files")
		}
		return &Dir{Root: dir, Secret: []byte(cfg.SessionKey)}
	}
	return nil
}
