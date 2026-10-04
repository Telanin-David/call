package wallet

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/billing"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

const dollar = 1_000_000

type env struct {
	t        *testing.T
	db       *pgxpool.Pool
	svc      *Service
	paystack *billing.Fake
	stripe   *billing.Fake
	server   *httptest.Server
	users    map[string]auth.User // by the X-Test-User header value
}

func newEnv(t *testing.T) *env {
	t.Helper()
	db := testdb.Pool(t)
	e := &env{
		t: t, db: db, users: map[string]auth.User{},
		paystack: &billing.Fake{ProviderName: "paystack", Secret: "ps-secret"},
		stripe:   &billing.Fake{ProviderName: "stripe", Secret: "st-secret"},
	}
	e.svc = &Service{
		DB:        db,
		Providers: map[string]billing.Provider{"paystack": e.paystack, "stripe": e.stripe},
		Charges:   map[string]Charge{"paystack": {"NGN", 160_000}, "stripe": {"USD", 100}},
		WebURL:    "https://app.dialer.test",
	}
	r := chi.NewRouter()
	e.svc.WebhookRoutes(r)
	r.Group(func(r chi.Router) {
		// Stand-in for the session cookie: the test names the user.
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if u, ok := e.users[req.Header.Get("X-Test-User")]; ok {
					req = req.WithContext(auth.WithUser(req.Context(), u))
				}
				next.ServeHTTP(w, req)
			})
		})
		e.svc.Routes(r)
	})
	e.server = httptest.NewServer(r)
	t.Cleanup(e.server.Close)
	return e
}

// rep makes a confirmed rep in a country and returns their handle.
func (e *env) rep(country, name string) auth.User {
	e.t.Helper()
	id := testdb.NewUser(e.t, e.db)
	u, err := auth.ScanUser(e.db.QueryRow(context.Background(), `
		UPDATE users SET country = $2, name = $3, email_confirmed = true, phone_confirmed = true, status = 'active', timezone = 'Africa/Lagos'
		WHERE id = $1 RETURNING `+auth.UserCols, id, country, name))
	if err != nil {
		e.t.Fatal(err)
	}
	e.users[u.ID] = u
	return u
}

func (e *env) do(method, path, user string, body any) (int, map[string]any, []byte) {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, e.server.URL+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", user)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw := new(bytes.Buffer)
	_, _ = raw.ReadFrom(resp.Body)
	out := map[string]any{}
	_ = json.Unmarshal(raw.Bytes(), &out)
	return resp.StatusCode, out, raw.Bytes()
}

// webhook posts a signed (or forged) provider webhook.
func (e *env) webhook(f *billing.Fake, ev billing.Event, forge bool) int {
	e.t.Helper()
	body, h := f.Sign(ev)
	if forge {
		h.Set("X-Fake-Signature", "forged")
	}
	req, _ := http.NewRequest(http.MethodPost, e.server.URL+"/webhooks/"+f.Name(), bytes.NewReader(body))
	for k, v := range h {
		req.Header[k] = v
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

func (e *env) balance(u auth.User) int64 {
	e.t.Helper()
	b, err := ledger.Balance(context.Background(), e.db, u.ID)
	if err != nil {
		e.t.Fatal(err)
	}
	return b
}

func (e *env) flags(u auth.User) int {
	var n int
	_ = e.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM fraud_flags WHERE user_id = $1`, u.ID).Scan(&n)
	return n
}

func (e *env) start(u auth.User, amount int64) (string, int64, string) {
	e.t.Helper()
	status, body, _ := e.do(http.MethodPost, "/wallet/topups", u.ID, map[string]int64{"amount_microdollars": amount})
	if status != http.StatusCreated {
		e.t.Fatalf("start top-up: %d %v", status, body)
	}
	var minor int64
	var cur string
	_ = e.db.QueryRow(context.Background(), `SELECT provider_amount_minor, currency FROM payments WHERE provider_ref = $1`, body["reference"]).Scan(&minor, &cur)
	return body["reference"].(string), minor, cur
}

func TestStartTopUp(t *testing.T) {
	e := newEnv(t)
	ng := e.rep("NG", "Tunde Bakare")
	us := e.rep("US", "Ada Obi")

	tests := []struct {
		name      string
		user      auth.User
		amount    int64
		status    int
		code      string
		provider  string
		wantMinor int64
		wantCur   string
	}{
		{"Nigeria pays with Paystack in naira", ng, 20 * dollar, 201, "", "paystack", 3_200_000, "NGN"},
		{"US pays with Stripe in dollars", us, 20 * dollar, 201, "", "stripe", 2000, "USD"},
		{"smallest top-up", us, 5 * dollar, 201, "", "stripe", 500, "USD"},
		{"largest top-up", us, 500 * dollar, 201, "", "stripe", 50_000, "USD"},
		{"under $5", us, 4_990_000, 422, "invalid_amount", "", 0, ""},
		{"over $500", us, 500*dollar + 10_000, 422, "invalid_amount", "", 0, ""},
		{"part of a cent", us, 10*dollar + 1, 422, "invalid_amount", "", 0, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, body, _ := e.do(http.MethodPost, "/wallet/topups", tt.user.ID, map[string]int64{"amount_microdollars": tt.amount})
			if status != tt.status || (tt.code != "" && body["code"] != tt.code) {
				t.Fatalf("got %d %v, want %d %q", status, body, tt.status, tt.code)
			}
			if tt.status != 201 {
				return
			}
			ref := body["reference"].(string)
			if body["provider"] != tt.provider || !strings.HasSuffix(body["payment_url"].(string), ref) {
				t.Fatalf("body = %v", body)
			}
			var minor, credit int64
			var cur, st string
			_ = e.db.QueryRow(context.Background(), `SELECT provider_amount_minor, currency, credited_microdollars, status FROM payments WHERE provider_ref = $1`, ref).Scan(&minor, &cur, &credit, &st)
			if minor != tt.wantMinor || cur != tt.wantCur || credit != tt.amount || st != "pending" {
				t.Fatalf("payment = %d %s credit %d %s", minor, cur, credit, st)
			}
		})
	}
	if e.balance(us) != 0 {
		t.Fatal("starting a top-up must not add money")
	}

	t.Run("unconfirmed reps can't top up", func(t *testing.T) {
		u := e.rep("US", "New Rep")
		u.PhoneConfirmed = false
		e.users[u.ID] = u
		if status, _, _ := e.do(http.MethodPost, "/wallet/topups", u.ID, map[string]int64{"amount_microdollars": 10 * dollar}); status != http.StatusForbidden {
			t.Fatalf("status = %d, want 403", status)
		}
	})

	t.Run("no provider for the country yet", func(t *testing.T) {
		delete(e.svc.Providers, "stripe")
		defer func() { e.svc.Providers["stripe"] = e.stripe }()
		status, body, _ := e.do(http.MethodPost, "/wallet/topups", us.ID, map[string]int64{"amount_microdollars": 10 * dollar})
		if status != http.StatusServiceUnavailable || body["code"] != "cards_unavailable" {
			t.Fatalf("got %d %v", status, body)
		}
	})

	t.Run("checkout page fails to open", func(t *testing.T) {
		u := e.rep("US", "Ada Obi")
		e.stripe.Fail = billing.ErrProvider
		defer func() { e.stripe.Fail = nil }()
		status, body, _ := e.do(http.MethodPost, "/wallet/topups", u.ID, map[string]int64{"amount_microdollars": 10 * dollar})
		if status != http.StatusBadGateway || body["code"] != "checkout_failed" {
			t.Fatalf("got %d %v", status, body)
		}
		var st string
		_ = e.db.QueryRow(context.Background(), `SELECT status FROM payments WHERE user_id = $1`, u.ID).Scan(&st)
		if st != "failed" {
			t.Fatalf("payment status = %q, want failed", st)
		}
	})

	t.Run("ten unfinished top-ups an hour", func(t *testing.T) {
		u := e.rep("US", "Ada Obi")
		for i := 0; i < 10; i++ {
			e.start(u, 5*dollar)
		}
		status, body, _ := e.do(http.MethodPost, "/wallet/topups", u.ID, map[string]int64{"amount_microdollars": 5 * dollar})
		if status != http.StatusTooManyRequests || body["code"] != "too_many" {
			t.Fatalf("got %d %v", status, body)
		}
	})
}

func TestWebhooks(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()

	t.Run("paid once, credited once", func(t *testing.T) {
		u := e.rep("NG", "Tunde Bakare")
		ref, minor, cur := e.start(u, 20*dollar)
		ev := billing.Event{Kind: billing.Paid, Reference: ref, AmountMinor: minor, Currency: cur, CardLast4: "4321", CardName: "BAKARE TUNDE A"}
		for i := 0; i < 3; i++ { // providers resend
			if s := e.webhook(e.paystack, ev, false); s != http.StatusOK {
				t.Fatalf("webhook %d: status %d", i, s)
			}
		}
		if got := e.balance(u); got != 20*dollar {
			t.Fatalf("balance = %d, want %d", got, 20*dollar)
		}
		_, body, _ := e.do(http.MethodGet, "/wallet/topups/"+ref, u.ID, nil)
		if body["status"] != "succeeded" {
			t.Fatalf("top-up status = %v", body)
		}
		var last4, name string
		_ = e.db.QueryRow(ctx, `SELECT card_last4, card_name FROM payments WHERE provider_ref = $1`, ref).Scan(&last4, &name)
		if last4 != "4321" || name != "BAKARE TUNDE A" || e.flags(u) != 0 {
			t.Fatalf("card %q %q, flags %d", last4, name, e.flags(u))
		}
	})

	t.Run("duplicates racing each other still credit once", func(t *testing.T) {
		u := e.rep("US", "Ada Obi")
		ref, minor, cur := e.start(u, 50*dollar)
		ev := billing.Event{Kind: billing.Paid, Reference: ref, AmountMinor: minor, Currency: cur}
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() { defer wg.Done(); e.webhook(e.stripe, ev, false) }()
		}
		wg.Wait()
		if got := e.balance(u); got != 50*dollar {
			t.Fatalf("balance = %d, want %d", got, 50*dollar)
		}
	})

	tests := []struct {
		name        string
		country     string
		change      func(*billing.Event)
		forge       bool
		wantStatus  int
		wantBalance int64
		wantPayment string
		wantFlags   int
	}{
		{"forged signature", "US", nil, true, http.StatusUnauthorized, 0, "pending", 0},
		{"paid less than asked", "US", func(ev *billing.Event) { ev.AmountMinor-- }, false, http.StatusOK, 0, "failed", 1},
		{"paid in another currency", "NG", func(ev *billing.Event) { ev.Currency = "USD" }, false, http.StatusOK, 0, "failed", 1},
		{"card name doesn't match: credited and flagged", "US", func(ev *billing.Event) { ev.CardName = "John Smith" }, false, http.StatusOK, 10 * dollar, "succeeded", 1},
		{"checkout expired", "US", func(ev *billing.Event) { ev.Kind = billing.Failed }, false, http.StatusOK, 0, "failed", 0},
		{"some other event", "US", func(ev *billing.Event) { ev.Kind = billing.Ignored }, false, http.StatusOK, 0, "pending", 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u := e.rep(tt.country, "Ada Obi")
			ref, minor, cur := e.start(u, 10*dollar)
			ev := billing.Event{Kind: billing.Paid, Reference: ref, AmountMinor: minor, Currency: cur}
			if tt.change != nil {
				tt.change(&ev)
			}
			f := e.stripe
			if tt.country == "NG" {
				f = e.paystack
			}
			if s := e.webhook(f, ev, tt.forge); s != tt.wantStatus {
				t.Fatalf("webhook status = %d, want %d", s, tt.wantStatus)
			}
			var st string
			_ = e.db.QueryRow(ctx, `SELECT status FROM payments WHERE provider_ref = $1`, ref).Scan(&st)
			if got := e.balance(u); got != tt.wantBalance || st != tt.wantPayment || e.flags(u) != tt.wantFlags {
				t.Fatalf("balance %d payment %q flags %d; want %d %q %d", got, st, e.flags(u), tt.wantBalance, tt.wantPayment, tt.wantFlags)
			}
		})
	}

	t.Run("paid after it was marked expired", func(t *testing.T) {
		u := e.rep("US", "Ada Obi")
		ref, minor, cur := e.start(u, 10*dollar)
		e.webhook(e.stripe, billing.Event{Kind: billing.Failed, Reference: ref}, false)
		e.webhook(e.stripe, billing.Event{Kind: billing.Paid, Reference: ref, AmountMinor: minor, Currency: cur}, false)
		if got := e.balance(u); got != 10*dollar {
			t.Fatalf("balance = %d: money that was taken must be credited", got)
		}
	})

	t.Run("a payment we never started", func(t *testing.T) {
		if s := e.webhook(e.stripe, billing.Event{Kind: billing.Paid, Reference: "top_unknown", AmountMinor: 500, Currency: "USD"}, false); s != http.StatusOK {
			t.Fatalf("status = %d, want 200 so the provider stops resending", s)
		}
	})

	t.Run("a Paystack webhook can't confirm a Stripe payment", func(t *testing.T) {
		u := e.rep("US", "Ada Obi")
		ref, minor, cur := e.start(u, 10*dollar)
		e.webhook(e.paystack, billing.Event{Kind: billing.Paid, Reference: ref, AmountMinor: minor, Currency: cur}, false)
		if got := e.balance(u); got != 0 {
			t.Fatalf("balance = %d, want 0", got)
		}
	})

	t.Run("reps only see their own top-ups", func(t *testing.T) {
		a, b := e.rep("US", "Ada Obi"), e.rep("US", "Bola Ade")
		ref, _, _ := e.start(a, 10*dollar)
		if status, _, _ := e.do(http.MethodGet, "/wallet/topups/"+ref, b.ID, nil); status != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", status)
		}
	})
}

func TestWalletSummaryAndStatement(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	u := e.rep("US", "Ada Obi")
	ref, minor, cur := e.start(u, 20*dollar)
	e.webhook(e.stripe, billing.Event{Kind: billing.Paid, Reference: ref, AmountMinor: minor, Currency: cur, CardLast4: "4242"}, false)

	tx, err := e.db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []ledger.Posting{
		{Type: ledger.TypePlan, Amount: 10 * dollar, Description: "Starter, month 1 of 3", Key: "t:plan:" + u.ID},
		{Type: ledger.TypeCall, Amount: 31_250, Description: "=HYPERLINK(\"x\")", Key: "t:call:" + u.ID},
	} {
		p.UserID = u.ID
		if _, err := ledger.Debit(ctx, tx, p); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := ledger.PlaceHold(ctx, tx, u.ID, "", 20_000, "t:hold:"+u.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	status, w, _ := e.do(http.MethodGet, "/wallet", u.ID, nil)
	if status != http.StatusOK {
		t.Fatalf("status %d", status)
	}
	spent := w["spent_this_month"].(map[string]any)
	if w["balance_microdollars"] != float64(20*dollar-10*dollar-31_250-20_000) || w["held_microdollars"] != float64(20_000) ||
		spent["plan"] != float64(10*dollar) || spent["calls"] != float64(31_250) || spent["total"] != float64(10*dollar+31_250) {
		t.Fatalf("wallet = %v", w)
	}
	if acts := w["activity"].([]any); len(acts) != 3 {
		t.Fatalf("activity has %d entries, want 3 (holds hidden)", len(acts))
	}

	status, _, raw := e.do(http.MethodGet, "/wallet/statement", u.ID, nil)
	if status != http.StatusOK {
		t.Fatalf("statement status %d", status)
	}
	rows, err := csv.NewReader(bytes.NewReader(raw)).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 5 {
		t.Fatalf("statement rows = %v", rows)
	}
	want := map[string][2]string{ // description → amount, running balance
		"Top-up, card ending 4242": {"20.00", "20.00"},
		"Starter, month 1 of 3":    {"-10.00", "10.00"},
		"'=HYPERLINK(\"x\")":       {"-0.03125", "9.96875"},
	}
	for _, r := range rows[2:] {
		w, ok := want[r[2]]
		if !ok || r[3] != w[0] || r[4] != w[1] {
			t.Errorf("row %v; want %v", r, w)
		}
	}
	if rows[1][2] != "Opening balance" || rows[1][4] != "0.00" {
		t.Errorf("opening row = %v", rows[1])
	}

	if status, _, _ := e.do(http.MethodGet, "/wallet/statement?month=October", u.ID, nil); status != http.StatusUnprocessableEntity {
		t.Fatalf("bad month status = %d", status)
	}
	if status, _, raw := e.do(http.MethodGet, "/wallet/statement?month=2020-01", u.ID, nil); status != http.StatusOK || strings.Count(string(raw), "\n") != 2 {
		t.Fatalf("empty month: %d %q", status, raw)
	}
}

func TestActivityPages(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	u := e.rep("US", "Ada Obi")
	for i := 0; i < 55; i++ {
		tx, _ := e.db.Begin(ctx)
		if _, err := ledger.Credit(ctx, tx, ledger.Posting{UserID: u.ID, Type: ledger.TypeRefund, Amount: 1, Key: "t:act:" + u.ID + ":" + string(rune('A'+i))}); err != nil {
			t.Fatal(err)
		}
		_ = tx.Commit(ctx)
	}
	_, first, _ := e.do(http.MethodGet, "/wallet/activity", u.ID, nil)
	cur, _ := first["next_cursor"].(string)
	if len(first["activity"].([]any)) != 50 || cur == "" {
		t.Fatalf("first page: %d entries, cursor %q", len(first["activity"].([]any)), cur)
	}
	_, second, _ := e.do(http.MethodGet, "/wallet/activity?cursor="+cur, u.ID, nil)
	if len(second["activity"].([]any)) != 5 || second["next_cursor"] != "" {
		t.Fatalf("second page = %v", second)
	}
	if status, _, _ := e.do(http.MethodGet, "/wallet/activity?cursor=not-a-cursor!", u.ID, nil); status != http.StatusBadRequest {
		t.Fatalf("broken cursor status = %d", status)
	}
}

func TestFormatUSD(t *testing.T) {
	tests := []struct {
		micro int64
		min   int
		want  string
	}{
		{20_000_000, 2, "$20.00"},
		{-31_250, 2, "-$0.03125"},
		{417, 2, "$0.000417"},
		{1, 2, "$0.000001"},
		{0, 2, "$0.00"},
		{5_000_000, 0, "$5"},
		{-1_500_000, 2, "-$1.50"},
	}
	for _, tt := range tests {
		if got := FormatUSD(tt.micro, tt.min); got != tt.want {
			t.Errorf("FormatUSD(%d, %d) = %q, want %q", tt.micro, tt.min, got, tt.want)
		}
	}
}

func TestNamesMatch(t *testing.T) {
	tests := []struct {
		account, card string
		want          bool
	}{
		{"Tunde Bakare", "TUNDE BAKARE", true},
		{"Tunde Bakare", "BAKARE TUNDE A", true},
		{"Tunde Bakare", "Bakare, Tunde", true},
		{"Ada Obi", "ADA N. OBI", true},
		{"Ada Obi", "John Smith", false},
		{"Ada Obi", "Ada Smith", false},
		{"Ada Obi", "", false},
	}
	for _, tt := range tests {
		if got := NamesMatch(tt.account, tt.card); got != tt.want {
			t.Errorf("NamesMatch(%q, %q) = %v, want %v", tt.account, tt.card, got, tt.want)
		}
	}
}

func TestToMinorAndMonths(t *testing.T) {
	tests := []struct {
		micro, rate, want int64
	}{
		{20_000_000, 100, 2000},          // $20 in cents
		{20_000_000, 160_000, 3_200_000}, // $20 at ₦1,600 in kobo
		{5_010_000, 155_555, 779_331},    // rounds up, never down
	}
	for _, tt := range tests {
		if got := toMinor(tt.micro, tt.rate); got != tt.want {
			t.Errorf("toMinor(%d, %d) = %d, want %d", tt.micro, tt.rate, got, tt.want)
		}
	}
	lagos := location("Africa/Lagos")
	// 23:30 UTC on 31 Oct is already 1 Nov in Lagos.
	from, to := monthBounds(time.Date(2026, 10, 31, 23, 30, 0, 0, time.UTC), lagos)
	if from.Month() != time.November || to.Month() != time.December {
		t.Fatalf("month = %v to %v", from, to)
	}
	if _, _, err := ParseMonth("2026-13", time.Now(), lagos); err == nil {
		t.Fatal("month 13 should not parse")
	}
	c := &ledger.Cursor{At: time.UnixMicro(1_790_000_000_123_456), ID: "00000000-0000-0000-0000-000000000001"}
	back, err := decodeCursor(encodeCursor(c))
	if err != nil || !back.At.Equal(c.At) || back.ID != c.ID {
		t.Fatalf("cursor round trip: %v %v", back, err)
	}
	if _, err := decodeCursor("bm9wZQ"); err == nil {
		t.Fatal("a cursor without an id should fail")
	}
}
