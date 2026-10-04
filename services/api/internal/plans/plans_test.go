package plans

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

const dollar = 1_000_000

func day(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

// at is a moment on a day, mid-morning UTC.
func at(s string) time.Time { return day(s).Add(10 * time.Hour) }

func TestAddMonths(t *testing.T) {
	tests := []struct {
		from   string
		n      int
		anchor int
		want   string
	}{
		{"2026-10-01", 1, 1, "2026-11-01"},
		{"2026-12-15", 1, 15, "2027-01-15"},
		{"2027-01-31", 1, 31, "2027-02-28"},
		{"2027-02-28", 1, 31, "2027-03-31"}, // back to the 31st, no drift
		{"2028-01-31", 1, 31, "2028-02-29"}, // leap year
		{"2026-11-01", -1, 1, "2026-10-01"},
		{"2027-03-31", -1, 31, "2027-02-28"},
		{"2026-10-01", 3, 1, "2027-01-01"},
	}
	for _, tt := range tests {
		if got := addMonths(day(tt.from), tt.n, tt.anchor); !got.Equal(day(tt.want)) {
			t.Errorf("addMonths(%s, %d, %d) = %s, want %s", tt.from, tt.n, tt.anchor, got.Format("2006-01-02"), tt.want)
		}
	}
}

func TestProrate(t *testing.T) {
	tests := []struct {
		name               string
		diff, left, period int64
		want               int64
	}{
		{"half a month", 10 * dollar, 15, 30, 5 * dollar},
		{"16 of 31 days of $11, up to the cent", 11 * dollar, 16, 31, 5_680_000},
		{"last day", 11 * dollar, 1, 31, 360_000},
		{"whole month", 11 * dollar, 31, 31, 11 * dollar},
		{"nothing left", 11 * dollar, 0, 31, 0},
		{"cheaper plan costs nothing now", -5 * dollar, 10, 30, 0},
		{"left can't exceed the period", 10 * dollar, 40, 30, 10 * dollar},
	}
	for _, tt := range tests {
		if got := prorate(tt.diff, tt.left, tt.period); got != tt.want {
			t.Errorf("%s: prorate = %d, want %d", tt.name, got, tt.want)
		}
	}
}

type env struct {
	t    *testing.T
	db   *pgxpool.Pool
	svc  *Service
	mail *notify.Fake
}

func newEnv(t *testing.T) *env {
	t.Helper()
	db := testdb.Pool(t)
	mail := &notify.Fake{}
	return &env{t: t, db: db, svc: &Service{DB: db, Mail: mail}, mail: mail}
}

func (e *env) rep() auth.User {
	e.t.Helper()
	id := testdb.NewUser(e.t, e.db)
	u, err := auth.ScanUser(e.db.QueryRow(context.Background(), `
		UPDATE users SET email_confirmed = true, phone_confirmed = true, status = 'active' WHERE id = $1 RETURNING `+auth.UserCols, id))
	if err != nil {
		e.t.Fatal(err)
	}
	return u
}

var keyN int

func (e *env) topUp(u auth.User, amount int64) {
	e.t.Helper()
	keyN++
	err := platform.InTx(context.Background(), e.db, func(tx pgx.Tx) error {
		_, err := ledger.Credit(context.Background(), tx, ledger.Posting{UserID: u.ID, Type: ledger.TypeTopUp, Amount: amount,
			Key: fmt.Sprintf("test:plans:%s:%d:%d", u.ID, keyN, time.Now().UnixNano())})
		return err
	})
	if err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) balance(u auth.User) int64 {
	b, err := ledger.Balance(context.Background(), e.db, u.ID)
	if err != nil {
		e.t.Fatal(err)
	}
	return b
}

func (e *env) sub(u auth.User) (Subscription, bool) {
	s, ok, err := Current(context.Background(), e.db, u.ID)
	if err != nil {
		e.t.Fatal(err)
	}
	return s, ok
}

func (e *env) change(u auth.User, to string, when time.Time) Quote {
	e.t.Helper()
	q, err := e.svc.Change(context.Background(), u, to, when)
	if err != nil {
		e.t.Fatalf("change to %s: %v", to, err)
	}
	return q
}

// The plan's "done when": a rep adds $10, upgrades to Starter, and every
// cent shows correctly.
func TestTenDollarsToStarter(t *testing.T) {
	e := newEnv(t)
	u := e.rep()
	e.topUp(u, 10*dollar)

	q, err := e.svc.Quote(context.Background(), u, "starter", at("2026-10-01"))
	if err != nil {
		t.Fatal(err)
	}
	if q.Kind != Upgrade || q.DueToday != 10*dollar || !q.Intro || q.BalanceAfter != 0 ||
		!q.NextRenewal.Equal(day("2026-11-01")) || q.NextCharge != 10*dollar {
		t.Fatalf("quote = %+v", q)
	}
	if e.balance(u) != 10*dollar {
		t.Fatal("a quote must not charge")
	}

	e.change(u, "starter", at("2026-10-01"))
	s, ok := e.sub(u)
	if !ok || s.PlanID != "starter" || !s.NextRenewal.Equal(day("2026-11-01")) || s.IntroEndsAt == nil || !toDate(*s.IntroEndsAt).Equal(day("2027-01-01")) {
		t.Fatalf("subscription = %+v", s)
	}
	if got := e.balance(u); got != 0 {
		t.Fatalf("balance = %d, want 0", got)
	}
	acts, _, _ := ledger.Activity(context.Background(), e.db, u.ID, nil, 10)
	if len(acts) != 2 || acts[0].Amount != -10*dollar || acts[0].Type != ledger.TypePlan || acts[1].Amount != 10*dollar {
		t.Fatalf("activity = %+v", acts)
	}
	var used bool
	_ = e.db.QueryRow(context.Background(), `SELECT intro_used FROM users WHERE id = $1`, u.ID).Scan(&used)
	if !used {
		t.Fatal("intro_used should be set")
	}
}

func TestChanges(t *testing.T) {
	ctx := context.Background()

	t.Run("not enough money to upgrade", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 9*dollar)
		if _, err := e.svc.Change(ctx, u, "starter", at("2026-10-01")); !errors.Is(err, ErrLowBalance) {
			t.Fatalf("err = %v, want ErrLowBalance", err)
		}
		if _, ok := e.sub(u); ok || e.balance(u) != 9*dollar {
			t.Fatal("a failed upgrade must change nothing")
		}
	})

	t.Run("Starter to Pro halfway through the month", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 30*dollar)
		e.change(u, "starter", at("2026-10-01"))
		q := e.change(u, "pro", at("2026-10-16"))
		// $21 − $10 intro prices, for 16 of October's 31 days, up to the cent.
		if q.Kind != Upgrade || q.DueToday != 5_680_000 || q.NextCharge != 21*dollar || !q.NextRenewal.Equal(day("2026-11-01")) {
			t.Fatalf("quote = %+v", q)
		}
		if got := e.balance(u); got != 30*dollar-10*dollar-5_680_000 {
			t.Fatalf("balance = %d", got)
		}
		if s, _ := e.sub(u); s.PlanID != "pro" || !s.NextRenewal.Equal(day("2026-11-01")) {
			t.Fatalf("subscription = %+v", s)
		}
	})

	t.Run("moving down waits for renewal; staying cancels it", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 50*dollar)
		e.change(u, "pro", at("2026-10-01"))
		before := e.balance(u)

		q := e.change(u, "starter", at("2026-10-10"))
		if q.Kind != Downgrade || q.DueToday != 0 || !q.StartsOn.Equal(day("2026-11-01")) || q.NextCharge != 10*dollar {
			t.Fatalf("quote = %+v", q)
		}
		if s, _ := e.sub(u); s.PlanID != "pro" || s.PendingChange != "starter" {
			t.Fatalf("subscription = %+v, want Pro until renewal", s)
		}
		e.change(u, "free", at("2026-10-11"))
		if s, _ := e.sub(u); s.PendingChange != "free" {
			t.Fatalf("pending = %q", s.PendingChange)
		}
		if q := e.change(u, "pro", at("2026-10-12")); q.Kind != Stay {
			t.Fatalf("kind = %s, want stay", q.Kind)
		}
		if s, _ := e.sub(u); s.PendingChange != "" || e.balance(u) != before {
			t.Fatalf("stay should cancel the move and cost nothing: %+v", s)
		}
	})

	t.Run("unknown plan", func(t *testing.T) {
		e := newEnv(t)
		if _, err := e.svc.Change(ctx, e.rep(), "gold", at("2026-10-01")); !errors.Is(err, ErrUnknownPlan) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("a double tap pays once", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 50*dollar)
		var wg sync.WaitGroup
		for i := 0; i < 5; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); _, _ = e.svc.Change(ctx, u, "starter", at("2026-10-01")) }()
		}
		wg.Wait()
		if got := e.balance(u); got != 40*dollar {
			t.Fatalf("balance = %d, want %d", got, 40*dollar)
		}
	})
}

func TestRenewals(t *testing.T) {
	ctx := context.Background()

	t.Run("intro months, then the full price, caught up after downtime", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 100*dollar)
		e.change(u, "starter", at("2026-10-01"))
		// The worker was off until 2 Jan: three renewals are owed.
		if _, err := e.svc.RenewDue(ctx, at("2027-01-02")); err != nil {
			t.Fatal(err)
		}
		// Oct $10 (start) + Nov $10 + Dec $10 intro + Jan $15 full.
		if got := e.balance(u); got != 100*dollar-10*dollar-10*dollar-10*dollar-15*dollar {
			t.Fatalf("balance = %d", got)
		}
		if s, _ := e.sub(u); !s.NextRenewal.Equal(day("2027-02-01")) {
			t.Fatalf("next renewal = %s", s.NextRenewal)
		}
		before := e.balance(u)
		if _, err := e.svc.RenewDue(ctx, at("2027-01-02")); err != nil {
			t.Fatal(err)
		}
		if e.balance(u) != before {
			t.Fatal("running renewals twice must not charge twice")
		}
	})

	t.Run("a booked move down happens at renewal", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 50*dollar)
		e.change(u, "pro", at("2026-10-01"))
		e.change(u, "starter", at("2026-10-20"))
		if _, err := e.svc.RenewDue(ctx, at("2026-11-01")); err != nil {
			t.Fatal(err)
		}
		s, _ := e.sub(u)
		if s.PlanID != "starter" || s.PendingChange != "" {
			t.Fatalf("subscription = %+v", s)
		}
		if got := e.balance(u); got != 50*dollar-21*dollar-10*dollar {
			t.Fatalf("balance = %d (Pro intro, then Starter intro)", got)
		}
	})

	t.Run("move to Free at renewal, and no second intro price", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 50*dollar)
		e.change(u, "starter", at("2026-10-01"))
		e.change(u, "free", at("2026-10-05"))
		if _, err := e.svc.RenewDue(ctx, at("2026-11-01")); err != nil {
			t.Fatal(err)
		}
		if _, ok := e.sub(u); ok {
			t.Fatal("should be on Free")
		}
		if got := e.balance(u); got != 40*dollar {
			t.Fatalf("balance = %d: moving to Free costs nothing", got)
		}
		if m, ok := e.mail.LastEmail(u.Email); !ok || !strings.Contains(m.Subject, "Free") {
			t.Fatalf("email = %+v", m)
		}
		q := e.change(u, "starter", at("2026-12-01"))
		if q.Intro || q.DueToday != 15*dollar {
			t.Fatalf("coming back: %+v, want the full $15", q)
		}
	})

	t.Run("can't pay: warn, wait 3 days, then Free", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 10*dollar)
		e.change(u, "starter", at("2026-10-01")) // balance now $0

		// Other tests' reps share the database, so check this rep, not totals.
		emails := func() int {
			n := 0
			for _, m := range e.mail.Emails {
				if m.To == u.Email {
					n++
				}
			}
			return n
		}
		_, _ = e.svc.RenewDue(ctx, at("2026-11-01"))
		s, ok := e.sub(u)
		if !ok || s.RenewalFailedAt == nil || emails() != 1 {
			t.Fatalf("subscription %+v, %d emails", s, emails())
		}
		if m, _ := e.mail.LastEmail(u.Email); !strings.Contains(m.Text, "$10.00") || !strings.Contains(m.Text, "4 Nov") {
			t.Fatalf("warning email = %q", m.Text)
		}
		_, _ = e.svc.RenewDue(ctx, at("2026-11-03"))
		if _, ok := e.sub(u); !ok || emails() != 1 {
			t.Fatal("day 2 of the grace period should change nothing")
		}
		_, _ = e.svc.RenewDue(ctx, at("2026-11-04"))
		if _, ok := e.sub(u); ok || emails() != 2 {
			t.Fatalf("should be on Free after the grace period, with a second email (%d)", emails())
		}
		if e.balance(u) != 0 {
			t.Fatal("nothing should have been charged")
		}
	})

	t.Run("can't pay, then tops up in time", func(t *testing.T) {
		e := newEnv(t)
		u := e.rep()
		e.topUp(u, 10*dollar)
		e.change(u, "starter", at("2026-10-01"))
		_, _ = e.svc.RenewDue(ctx, at("2026-11-01"))
		e.topUp(u, 20*dollar)
		_, _ = e.svc.RenewDue(ctx, at("2026-11-02"))
		s, _ := e.sub(u)
		if s.RenewalFailedAt != nil || !s.NextRenewal.Equal(day("2026-12-01")) || e.balance(u) != 10*dollar {
			t.Fatalf("subscription = %+v, balance %d", s, e.balance(u))
		}
	})
}

func TestHTTP(t *testing.T) {
	e := newEnv(t)
	u := e.rep()
	e.topUp(u, 5*dollar)
	users := map[string]auth.User{u.ID: u}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if v, ok := users[req.Header.Get("X-Test-User")]; ok {
				req = req.WithContext(auth.WithUser(req.Context(), v))
			}
			next.ServeHTTP(w, req)
		})
	})
	e.svc.Routes(r)
	srv := httptest.NewServer(r)
	defer srv.Close()

	call := func(method, path string, body any) (int, map[string]any) {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req, _ := http.NewRequest(method, srv.URL+path, &buf)
		req.Header.Set("X-Test-User", u.ID)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out := map[string]any{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}

	status, body := call(http.MethodGet, "/plans", nil)
	if status != 200 || body["intro_eligible"] != true {
		t.Fatalf("plans: %d %v", status, body)
	}
	prices := map[string]float64{}
	for _, p := range body["plans"].([]any) {
		m := p.(map[string]any)
		prices[m["id"].(string)] = m["us_price_per_minute_microdollars"].(float64)
	}
	if prices["free"] != 25_000 || prices["starter"] != 20_000 || prices["pro"] != 17_000 {
		t.Fatalf("US prices = %v (must match the screens: $0.025, $0.02, $0.017)", prices)
	}

	if status, body := call(http.MethodGet, "/subscription", nil); status != 200 || body["plan"] != "free" {
		t.Fatalf("subscription: %d %v", status, body)
	}
	status, body = call(http.MethodPost, "/subscription/quote", map[string]string{"plan_id": "starter"})
	if status != 200 || body["due_today_microdollars"] != float64(10*dollar) || body["balance_after_microdollars"] != float64(-5*dollar) {
		t.Fatalf("quote: %d %v", status, body)
	}
	if status, body := call(http.MethodPost, "/subscription", map[string]string{"plan_id": "starter"}); status != http.StatusPaymentRequired || body["code"] != "low_balance" {
		t.Fatalf("upgrade with $5: %d %v", status, body)
	}
	e.topUp(u, 10*dollar)
	if status, body := call(http.MethodPost, "/subscription", map[string]string{"plan_id": "starter"}); status != 200 || body["kind"] != "upgrade" {
		t.Fatalf("upgrade: %d %v", status, body)
	}
	status, body = call(http.MethodGet, "/subscription", nil)
	if status != 200 || body["plan"] != "starter" || body["next_charge_microdollars"] != float64(10*dollar) || body["pending_change"] != nil {
		t.Fatalf("subscription: %d %v", status, body)
	}
	if status, body := call(http.MethodPost, "/subscription", map[string]string{"plan_id": "platinum"}); status != 422 || body["code"] != "unknown_plan" {
		t.Fatalf("unknown plan: %d %v", status, body)
	}
}
