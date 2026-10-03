// Package testdb gives tests a migrated Postgres database. Tests that need it
// are skipped when DATABASE_URL is unset; CI always sets it.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/platform"
)

// Pool connects to DATABASE_URL and closes the pool when the test ends.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set")
	}
	pool, err := platform.OpenDB(context.Background(), url)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// NewUser inserts a user with a unique email and returns its id, so tests
// never share money or rows with each other.
func NewUser(t testing.TB, pool *pgxpool.Pool) string {
	t.Helper()
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("random: %v", err)
	}
	var id string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (name, email, phone, password_hash, country)
		VALUES ('Test Rep', $1, '+15550100', 'x', 'US') RETURNING id`,
		"test-"+hex.EncodeToString(b)+"@example.test").Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}
