package ledger_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

func TestHolds(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	const price = 25_000 // Free plan, US, per minute

	// Each step runs in its own transaction against a fresh hold.
	type step func(tx pgx.Tx, h ledger.Hold) error
	settle := func(charge int64) step {
		return func(tx pgx.Tx, h ledger.Hold) error {
			_, err := ledger.Settle(ctx, tx, h.ID, charge, "Call")
			return err
		}
	}
	release := func(tx pgx.Tx, h ledger.Hold) error { return ledger.Release(ctx, tx, h.ID) }
	// The same name on the same hold is a retry of the same extension.
	extend := func(name string) step {
		return func(tx pgx.Tx, h ledger.Hold) error {
			_, err := ledger.ExtendHold(ctx, tx, h.ID, price, "test:"+h.ID+":"+name)
			return err
		}
	}

	tests := []struct {
		name        string
		start       int64
		steps       []step
		wantErr     error // from the last step
		wantBalance int64
		wantStatus  ledger.HoldStatus
		wantHeld    int64
	}{
		{"open hold takes a minute off", dollar, nil, nil, dollar - price, ledger.HoldOpen, price},
		{"settle 75 s charges per second", dollar, []step{extend("ext1"), settle(31_250)}, nil, dollar - 31_250, ledger.HoldSettled, 0},
		{"settle for nothing", dollar, []step{settle(0)}, nil, dollar, ledger.HoldSettled, 0},
		{"release gives it all back", dollar, []step{release}, nil, dollar, ledger.HoldReleased, 0},
		{"release twice is fine", dollar, []step{release, release}, nil, dollar, ledger.HoldReleased, 0},
		{"settle twice with the same charge is fine", dollar, []step{settle(400), settle(400)}, nil, dollar - 400, ledger.HoldSettled, 0},
		{"settle again with a new charge fails", dollar, []step{settle(400), settle(500)}, ledger.ErrHoldClosed, dollar - 400, ledger.HoldSettled, 0},
		{"charge above the hold fails", dollar, []step{settle(price + 1)}, ledger.ErrChargeAboveHold, dollar - price, ledger.HoldOpen, price},
		{"negative charge fails", dollar, []step{settle(-1)}, ledger.ErrBadAmount, dollar - price, ledger.HoldOpen, price},
		{"settle after release fails", dollar, []step{release, settle(10)}, ledger.ErrHoldClosed, dollar, ledger.HoldReleased, 0},
		{"release after settle fails", dollar, []step{settle(10), release}, ledger.ErrHoldClosed, dollar - 10, ledger.HoldSettled, 0},
		{"extend after settle fails", dollar, []step{settle(10), extend("late")}, ledger.ErrHoldClosed, dollar - 10, ledger.HoldSettled, 0},
		{"extend when the money runs out", price + 10, []step{extend("ext1")}, ledger.ErrInsufficientFunds, 10, ledger.HoldOpen, price},
		{"the same extension twice counts once", dollar, []step{extend("ext1"), extend("ext1")}, nil, dollar - 2*price, ledger.HoldOpen, 2 * price},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			user := testdb.NewUser(t, pool)
			topUp(t, pool, user, tt.start)
			h, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Hold, error) {
				return ledger.PlaceHold(ctx, tx, user, "", price, key(t))
			})
			if err != nil {
				t.Fatal(err)
			}
			for i, s := range tt.steps {
				err = platform.InTx(ctx, pool, func(tx pgx.Tx) error { return s(tx, h) })
				if i < len(tt.steps)-1 && err != nil {
					t.Fatalf("step %d: %v", i, err)
				}
			}
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			got, err := ledger.GetHold(ctx, pool, h.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != tt.wantStatus {
				t.Fatalf("status = %s, want %s", got.Status, tt.wantStatus)
			}
			if (got.ClosedAt != nil) != (tt.wantStatus != ledger.HoldOpen) {
				t.Fatalf("closed_at = %v for a %s hold", got.ClosedAt, got.Status)
			}
			if b := balance(t, pool, user); b != tt.wantBalance {
				t.Fatalf("balance = %d, want %d", b, tt.wantBalance)
			}
			if held, _ := ledger.Held(ctx, pool, user); held != tt.wantHeld {
				t.Fatalf("held = %d, want %d", held, tt.wantHeld)
			}
		})
	}
}

func TestPlaceHoldIsIdempotent(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	user := testdb.NewUser(t, pool)
	topUp(t, pool, user, dollar)
	k := key(t)
	place := func(amount int64) (ledger.Hold, error) {
		return inTx(t, pool, func(tx pgx.Tx) (ledger.Hold, error) {
			return ledger.PlaceHold(ctx, tx, user, "", amount, k)
		})
	}

	first, err := place(25_000)
	if err != nil {
		t.Fatal(err)
	}
	again, err := place(25_000)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != first.ID {
		t.Fatalf("retry made a second hold %s, want %s", again.ID, first.ID)
	}
	if _, err := place(30_000); !errors.Is(err, ledger.ErrKeyReused) {
		t.Fatalf("same key, new amount: err = %v, want ErrKeyReused", err)
	}
	if b := balance(t, pool, user); b != dollar-25_000 {
		t.Fatalf("balance = %d, want %d", b, dollar-25_000)
	}
}

func TestMissingHold(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	const nobody = "00000000-0000-0000-0000-000000000000"
	err := platform.InTx(ctx, pool, func(tx pgx.Tx) error { return ledger.Release(ctx, tx, nobody) })
	if !errors.Is(err, ledger.ErrHoldNotFound) {
		t.Fatalf("err = %v, want ErrHoldNotFound", err)
	}
}
