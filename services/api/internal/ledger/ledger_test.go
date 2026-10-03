package ledger_test

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/rates"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

const dollar = 1_000_000

var (
	run  = rand.Int64()
	keyN int
)

// key returns an idempotency key no other test, or earlier run, has used.
func key(t *testing.T) string {
	keyN++
	return fmt.Sprintf("test:%x:%s:%d", run, t.Name(), keyN)
}

func inTx[T any](t *testing.T, pool *pgxpool.Pool, fn func(pgx.Tx) (T, error)) (T, error) {
	t.Helper()
	var out T
	err := platform.InTx(context.Background(), pool, func(tx pgx.Tx) error {
		var err error
		out, err = fn(tx)
		return err
	})
	return out, err
}

func balance(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	b, err := ledger.Balance(context.Background(), pool, userID)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func topUp(t *testing.T, pool *pgxpool.Pool, userID string, amount int64) {
	t.Helper()
	_, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Entry, error) {
		return ledger.Credit(context.Background(), tx, ledger.Posting{UserID: userID, Type: ledger.TypeTopUp, Amount: amount, Key: key(t)})
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestCreditAndDebit(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)

	tests := []struct {
		name        string
		start       int64
		credit      bool
		posting     ledger.Posting
		wantErr     error
		wantBalance int64
	}{
		{"top-up", 0, true, ledger.Posting{Type: ledger.TypeTopUp, Amount: 10 * dollar}, nil, 10 * dollar},
		{"refund", 0, true, ledger.Posting{Type: ledger.TypeRefund, Amount: 1}, nil, 1},
		{"plan fee", 10 * dollar, false, ledger.Posting{Type: ledger.TypePlan, Amount: 10 * dollar}, nil, 0},
		{"number rent", 2 * dollar, false, ledger.Posting{Type: ledger.TypeNumber, Amount: 1_500_000}, nil, 500_000},
		{"debit one micro-dollar too many", 10 * dollar, false, ledger.Posting{Type: ledger.TypePlan, Amount: 10*dollar + 1}, ledger.ErrInsufficientFunds, 10 * dollar},
		{"debit with no money", 0, false, ledger.Posting{Type: ledger.TypeCall, Amount: 1}, ledger.ErrInsufficientFunds, 0},
		{"zero amount", 0, true, ledger.Posting{Type: ledger.TypeTopUp, Amount: 0}, ledger.ErrBadAmount, 0},
		{"negative amount", 5 * dollar, false, ledger.Posting{Type: ledger.TypePlan, Amount: -1}, ledger.ErrBadAmount, 5 * dollar},
		{"crediting a debit type", 0, true, ledger.Posting{Type: ledger.TypeCall, Amount: 1}, ledger.ErrWrongDirection, 0},
		{"debiting a credit type", 5 * dollar, false, ledger.Posting{Type: ledger.TypeTopUp, Amount: 1}, ledger.ErrWrongDirection, 5 * dollar},
		{"no key", 0, true, ledger.Posting{Type: ledger.TypeTopUp, Amount: 1, Key: "-"}, ledger.ErrNoKey, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			user := testdb.NewUser(t, pool)
			if tt.start > 0 {
				topUp(t, pool, user, tt.start)
			}
			p := tt.posting
			p.UserID = user
			switch p.Key {
			case "":
				p.Key = key(t)
			case "-":
				p.Key = ""
			}
			e, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Entry, error) {
				if tt.credit {
					return ledger.Credit(ctx, tx, p)
				}
				return ledger.Debit(ctx, tx, p)
			})
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			if err == nil {
				want := p.Amount
				if !tt.credit {
					want = -want
				}
				if e.Amount != want || e.ID == "" || e.Replayed {
					t.Fatalf("entry = %+v, want a new entry of %d", e, want)
				}
			}
			if got := balance(t, pool, user); got != tt.wantBalance {
				t.Fatalf("balance = %d, want %d", got, tt.wantBalance)
			}
		})
	}
}

func TestIdempotency(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	user := testdb.NewUser(t, pool)
	other := testdb.NewUser(t, pool)
	k := key(t)
	p := ledger.Posting{UserID: user, Type: ledger.TypeTopUp, Amount: 10 * dollar, Key: k, Description: "Card top-up"}

	credit := func(p ledger.Posting) (ledger.Entry, error) {
		return inTx(t, pool, func(tx pgx.Tx) (ledger.Entry, error) { return ledger.Credit(ctx, tx, p) })
	}

	first, err := credit(p)
	if err != nil {
		t.Fatal(err)
	}
	again, err := credit(p)
	if err != nil {
		t.Fatal(err)
	}
	if !again.Replayed || again.ID != first.ID {
		t.Fatalf("second credit = %+v, want a replay of %s", again, first.ID)
	}
	if got := balance(t, pool, user); got != 10*dollar {
		t.Fatalf("balance after a repeated webhook = %d, want %d", got, 10*dollar)
	}

	tests := []struct {
		name   string
		change func(*ledger.Posting)
	}{
		{"different amount", func(p *ledger.Posting) { p.Amount = 20 * dollar }},
		{"different user", func(p *ledger.Posting) { p.UserID = other }},
		{"different type", func(p *ledger.Posting) { p.Type = ledger.TypeRefund }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			q := p
			tt.change(&q)
			if _, err := credit(q); !errors.Is(err, ledger.ErrKeyReused) {
				t.Fatalf("err = %v, want ErrKeyReused", err)
			}
		})
	}
}

func TestRollbackUndoesTheEntry(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	user := testdb.NewUser(t, pool)
	boom := errors.New("payment row failed")
	err := platform.InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := ledger.Credit(ctx, tx, ledger.Posting{UserID: user, Type: ledger.TypeTopUp, Amount: dollar, Key: key(t)}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want %v", err, boom)
	}
	if got := balance(t, pool, user); got != 0 {
		t.Fatalf("balance = %d, want 0 after rollback", got)
	}
}

// Twenty debits of $0.10 race for $1.00. Exactly ten may win.
func TestConcurrentDebitsNeverOverdraw(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	user := testdb.NewUser(t, pool)
	topUp(t, pool, user, dollar)

	const tries = 20
	keys := make([]string, tries)
	for i := range keys {
		keys[i] = key(t)
	}
	var wg sync.WaitGroup
	errs := make([]error, tries)
	for i := 0; i < tries; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = platform.InTx(ctx, pool, func(tx pgx.Tx) error {
				_, err := ledger.Debit(ctx, tx, ledger.Posting{UserID: user, Type: ledger.TypeCall, Amount: dollar / 10, Key: keys[i]})
				return err
			})
		}(i)
	}
	wg.Wait()

	won := 0
	for _, err := range errs {
		switch {
		case err == nil:
			won++
		case errors.Is(err, ledger.ErrInsufficientFunds):
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if won != 10 {
		t.Fatalf("%d debits went through, want 10", won)
	}
	if got := balance(t, pool, user); got != 0 {
		t.Fatalf("balance = %d, want 0", got)
	}
}

func TestActivity(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	user := testdb.NewUser(t, pool)
	topUp(t, pool, user, 10*dollar)
	topUp(t, pool, user, 5*dollar)
	_, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Entry, error) {
		return ledger.Debit(ctx, tx, ledger.Posting{UserID: user, Type: ledger.TypePlan, Amount: 10 * dollar, Key: key(t), Description: "Starter, first month"})
	})
	if err != nil {
		t.Fatal(err)
	}
	// An open hold must not show as activity, only as Held.
	if _, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Hold, error) {
		return ledger.PlaceHold(ctx, tx, user, "", 25_000, key(t))
	}); err != nil {
		t.Fatal(err)
	}

	var all []ledger.Entry
	var cur *ledger.Cursor
	for pages := 0; ; pages++ {
		page, next, err := ledger.Activity(ctx, pool, user, cur, 2)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, page...)
		if next == nil {
			if pages != 1 {
				t.Fatalf("read %d extra pages, want 1", pages)
			}
			break
		}
		cur = next
	}
	if len(all) != 3 {
		t.Fatalf("activity has %d entries, want 3 (two top-ups and a plan fee): %+v", len(all), all)
	}
	var sum int64
	for _, e := range all {
		if e.Type == ledger.TypeHold || e.Type == ledger.TypeRelease {
			t.Fatalf("activity shows a %s entry", e.Type)
		}
		sum += e.Amount
	}
	if sum != 5*dollar {
		t.Fatalf("activity adds up to %d, want %d", sum, 5*dollar)
	}
	if held, _ := ledger.Held(ctx, pool, user); held != 25_000 {
		t.Fatalf("held = %d, want 25000", held)
	}
	if got := balance(t, pool, user); got != 5*dollar-25_000 {
		t.Fatalf("balance = %d, want %d", got, 5*dollar-25_000)
	}
}

// The plan's "done when": a rep adds $10, upgrades to Starter at the intro
// price, makes a 75-second call, and every micro-dollar adds up.
func TestTenDollarsStarterAndACall(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	user := testdb.NewUser(t, pool)

	topUp(t, pool, user, 10*dollar)
	if _, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Entry, error) {
		return ledger.Debit(ctx, tx, ledger.Posting{UserID: user, Type: ledger.TypePlan, Amount: 10 * dollar, Key: key(t)})
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Hold, error) {
		return ledger.PlaceHold(ctx, tx, user, "", 20_000, key(t))
	}); !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("hold with $0 left: err = %v, want ErrInsufficientFunds", err)
	}

	topUp(t, pool, user, 5*dollar)
	q, err := rates.For(ctx, pool, "starter", "+1 415 555 0100")
	if err != nil {
		t.Fatal(err)
	}
	h, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Hold, error) {
		return ledger.PlaceHold(ctx, tx, user, "", q.Hold(), key(t))
	})
	if err != nil {
		t.Fatal(err)
	}
	if h, err = inTx(t, pool, func(tx pgx.Tx) (ledger.Hold, error) {
		return ledger.ExtendHold(ctx, tx, h.ID, q.Hold(), key(t))
	}); err != nil {
		t.Fatal(err)
	}
	charge := q.Charge(75)
	if _, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Entry, error) {
		return ledger.Settle(ctx, tx, h.ID, charge, "Call to +1 415 555 0100")
	}); err != nil {
		t.Fatal(err)
	}
	if charge != 25_000 {
		t.Fatalf("75 s on Starter at $0.02/min = %d, want 25000", charge)
	}
	if got := balance(t, pool, user); got != 5*dollar-25_000 {
		t.Fatalf("balance = %d, want %d ($4.975)", got, 5*dollar-25_000)
	}
}
