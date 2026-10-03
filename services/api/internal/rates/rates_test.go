package rates_test

import (
	"context"
	"errors"
	"testing"

	"github.com/telanin-david/call/services/api/internal/rates"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

func TestPricePerMinute(t *testing.T) {
	tests := []struct {
		name string
		cost int64
		pct  int
		want int64
	}{
		{"free on $0.01", 10_000, 250, 25_000},
		{"starter on $0.01", 10_000, 200, 20_000},
		{"pro on $0.01", 10_000, 170, 17_000},
		{"rounds half up", 3, 250, 8},         // 7.5 → 8
		{"rounds down below half", 1, 140, 1}, // 1.4 → 1
		{"zero cost", 0, 250, 0},
		{"zero multiplier", 10_000, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rates.PricePerMinute(tt.cost, tt.pct); got != tt.want {
				t.Fatalf("PricePerMinute(%d, %d) = %d, want %d", tt.cost, tt.pct, got, tt.want)
			}
		})
	}
}

func TestCharge(t *testing.T) {
	tests := []struct {
		name    string
		price   int64
		seconds int64
		want    int64
	}{
		{"one second", 25_000, 1, 417}, // 416.67 → 417
		{"exactly a minute", 25_000, 60, 25_000},
		{"75 seconds", 25_000, 75, 31_250},
		{"rounds up a fraction", 17_000, 7, 1_984}, // 1983.33 → 1984
		{"zero seconds", 25_000, 0, 0},
		{"negative seconds", 25_000, -5, 0},
		{"an hour on Pro", 17_000, 3600, 1_020_000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rates.Charge(tt.price, tt.seconds); got != tt.want {
				t.Fatalf("Charge(%d, %d) = %d, want %d", tt.price, tt.seconds, got, tt.want)
			}
		})
	}
}

func TestDigits(t *testing.T) {
	tests := []struct{ in, want string }{
		{"+1 (415) 555-0100", "14155550100"},
		{"233 24 000 0000", "233240000000"},
		{"", ""},
		{"call me", ""},
	}
	for _, tt := range tests {
		if got := rates.Digits(tt.in); got != tt.want {
			t.Errorf("Digits(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestFor(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })

	// Made-up prefixes so the test never meets a real rate card. Rolled back.
	_, err = tx.Exec(ctx, `
		INSERT INTO rate_cards (country, prefix, cost_per_min, started_at) VALUES
			('Testland',        '9991',  10000, NOW() - INTERVAL '1 day'),
			('Testland mobile', '99912', 30000, NOW() - INTERVAL '1 day'),
			('Testland mobile', '99912', 90000, NOW() + INTERVAL '1 day'),
			('Testland',        '9991',  12000, NOW() - INTERVAL '1 hour')`)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name       string
		plan       string
		number     string
		wantPrefix string
		wantPrice  int64
		wantErr    error
	}{
		{"newest card for the prefix", "free", "+999 1000 0000", "9991", 30_000, nil},
		{"longest prefix wins, future card ignored", "starter", "+999 1200 0000", "99912", 60_000, nil},
		{"pro multiplier", "pro", "99910000000", "9991", 20_400, nil},
		{"US/CA seed rate on Free is $0.025", "free", "+1 415 555 0100", "1", 25_000, nil},
		{"no card", "free", "+998 0000", "", 0, rates.ErrNoRate},
		{"empty number", "free", "", "", 0, rates.ErrNoRate},
		{"unknown plan", "gold", "+1 415 555 0100", "", 0, rates.ErrNoRate},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q, err := rates.For(ctx, tx, tt.plan, tt.number)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			if err != nil {
				return
			}
			if q.Prefix != tt.wantPrefix || q.PricePerMin != tt.wantPrice {
				t.Fatalf("got prefix %q price %d, want %q %d", q.Prefix, q.PricePerMin, tt.wantPrefix, tt.wantPrice)
			}
			if q.Hold() != q.PricePerMin || q.Charge(60) != q.PricePerMin {
				t.Fatalf("hold %d and one-minute charge %d should both equal the price %d", q.Hold(), q.Charge(60), q.PricePerMin)
			}
		})
	}
}
