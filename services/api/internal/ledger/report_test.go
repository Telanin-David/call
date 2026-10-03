package ledger_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

func TestSpentAndStatement(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	user := testdb.NewUser(t, pool)
	start := time.Now().Add(-time.Second)
	topUp(t, pool, user, 20*dollar)
	debit := func(typ ledger.Type, amount int64) {
		t.Helper()
		if _, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Entry, error) {
			return ledger.Debit(ctx, tx, ledger.Posting{UserID: user, Type: typ, Amount: amount, Key: key(t)})
		}); err != nil {
			t.Fatal(err)
		}
	}
	debit(ledger.TypePlan, 10*dollar)
	debit(ledger.TypeNumber, 1_500_000)
	debit(ledger.TypeCall, 31_250)
	debit(ledger.TypeCall, 417)
	h, err := inTx(t, pool, func(tx pgx.Tx) (ledger.Hold, error) { return ledger.PlaceHold(ctx, tx, user, "", 25_000, key(t)) })
	if err != nil {
		t.Fatal(err)
	}
	_ = h

	spent, err := ledger.Spent(ctx, pool, user, start)
	if err != nil {
		t.Fatal(err)
	}
	want := map[ledger.Type]int64{ledger.TypePlan: 10 * dollar, ledger.TypeNumber: 1_500_000, ledger.TypeCall: 31_667}
	for typ, n := range want {
		if spent[typ] != n {
			t.Errorf("spent[%s] = %d, want %d", typ, spent[typ], n)
		}
	}
	if len(spent) != len(want) {
		t.Errorf("spent = %v (holds must not count)", spent)
	}
	if later, _ := ledger.Spent(ctx, pool, user, time.Now().Add(time.Hour)); len(later) != 0 {
		t.Errorf("nothing was spent after now, got %v", later)
	}

	st, err := ledger.Statement(ctx, pool, user, start, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	var sum int64
	for _, e := range st {
		sum += e.Amount
	}
	if len(st) != 5 || sum != 20*dollar-10*dollar-1_500_000-31_667 {
		t.Fatalf("statement has %d entries adding to %d", len(st), sum)
	}
	if st[0].Type != ledger.TypeTopUp {
		t.Fatalf("statement should start with the top-up, got %s", st[0].Type)
	}
}
