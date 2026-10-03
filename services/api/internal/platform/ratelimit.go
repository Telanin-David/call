package platform

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/valkey-io/valkey-go"
)

// Limiter counts events per key in fixed windows ("5 sign-ups per hour from
// one address"). Allow records one event and reports whether it is within
// the limit.
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error)
}

// ValkeyLimiter keeps counts in Valkey so every api process shares them.
type ValkeyLimiter struct{ Client valkey.Client }

func (l ValkeyLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	k := "rl:" + key
	// Create the counter with its expiry first, so a crash between the two
	// commands can never leave a counter that lives forever.
	res := l.Client.DoMulti(ctx,
		l.Client.B().Set().Key(k).Value("0").Nx().Ex(window).Build(),
		l.Client.B().Incr().Key(k).Build(),
	)
	if err := res[0].Error(); err != nil && !valkey.IsValkeyNil(err) {
		return false, fmt.Errorf("rate limit: %w", err)
	}
	n, err := res[1].AsInt64()
	if err != nil {
		return false, fmt.Errorf("rate limit: %w", err)
	}
	return n <= int64(limit), nil
}

// MemoryLimiter is a Limiter for tests and single-process development.
type MemoryLimiter struct {
	mu  sync.Mutex
	hit map[string]memWindow
	now func() time.Time
}

type memWindow struct {
	n     int
	until time.Time
}

func NewMemoryLimiter() *MemoryLimiter {
	return &MemoryLimiter{hit: map[string]memWindow{}, now: time.Now}
}

func (l *MemoryLimiter) Allow(_ context.Context, key string, limit int, window time.Duration) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	w := l.hit[key]
	if !now.Before(w.until) {
		w = memWindow{until: now.Add(window)}
	}
	w.n++
	l.hit[key] = w
	return w.n <= limit, nil
}
