package numbers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/telephony"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

const dollar = 1_000_000

type env struct {
	t        *testing.T
	svc      *Service
	provider *telephony.FakeNumbers
	mail     *notify.Fake
}

func newEnv(t *testing.T) *env {
	t.Helper()
	p := &telephony.FakeNumbers{}
	mail := &notify.Fake{}
	return &env{t: t, svc: &Service{DB: testdb.Pool(t), Provider: p, Mail: mail, Limiter: platform.NewMemoryLimiter()}, provider: p, mail: mail}
}

func (e *env) rep(balance int64) string {
	e.t.Helper()
	id := testdb.NewUser(e.t, e.svc.DB)
	if balance > 0 {
		e.topUp(id, balance)
	}
	return id
}

var keyN int

func (e *env) topUp(userID string, amount int64) {
	e.t.Helper()
	keyN++
	err := platform.InTx(context.Background(), e.svc.DB, func(tx pgx.Tx) error {
		_, err := ledger.Credit(context.Background(), tx, ledger.Posting{UserID: userID, Type: ledger.TypeTopUp, Amount: amount,
			Key: fmt.Sprintf("test:numbers:%s:%d:%d", userID, keyN, time.Now().UnixNano())})
		return err
	})
	if err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) balance(userID string) int64 {
	e.t.Helper()
	b, err := ledger.Balance(context.Background(), e.svc.DB, userID)
	if err != nil {
		e.t.Fatal(err)
	}
	return b
}

// nextArea gives each test its own area code, so fake numbers never clash
// with another test's rented ones, in this run or one before it (the test
// database keeps rows between runs).
var areaN = 200 + int(time.Now().UnixNano()%700)

func nextArea() string {
	for {
		areaN++
		if areaN > 999 {
			areaN = 201
		}
		// Skip codes that are never offered: N11 service codes, the
		// Caribbean and US territories, and 900.
		if rentable(fmt.Sprintf("+1%d5550142", areaN)) {
			return fmt.Sprint(areaN)
		}
	}
}

func (e *env) rent(userID string) Number {
	e.t.Helper()
	found, err := e.svc.Search(context.Background(), userID, "US", nextArea())
	if err != nil || len(found) == 0 {
		e.t.Fatalf("search: %v %v", found, err)
	}
	n, err := e.svc.Rent(context.Background(), userID, RentInput{E164: found[0].E164, City: "New York, NY", Country: "US"})
	if err != nil {
		e.t.Fatal(err)
	}
	return n
}

func TestPriceAndPretty(t *testing.T) {
	if Price() != 1_500_000 {
		t.Fatalf("Price = %d, want $1.50 (cost × 1.5)", Price())
	}
	if got := Pretty("+16465550142"); got != "+1 (646) 555-0142" {
		t.Errorf("Pretty = %q", got)
	}
	if got := Pretty("+442079460958"); got != "+442079460958" {
		t.Errorf("Pretty abroad = %q", got)
	}
}

func TestSearch(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	user := e.rep(0)
	for _, tt := range []struct{ country, area string }{{"GB", "646"}, {"US", "64"}, {"US", "146"}, {"US", "411"}, {"US", "abc"}} {
		if _, err := e.svc.Search(ctx, user, tt.country, tt.area); err == nil {
			t.Errorf("Search(%s, %s) should be refused", tt.country, tt.area)
		}
	}
	found, err := e.svc.Search(ctx, user, "us", "646")
	if err != nil || len(found) == 0 || found[0].City != "New York, NY" {
		t.Fatalf("search = %+v, %v", found, err)
	}

	t.Run("hides numbers rented on our account, pricier ones and non-mainland ones", func(t *testing.T) {
		area := nextArea()
		rented, pricier := "+1"+area+"5550101", "+1"+area+"5550102"
		s := &Service{DB: e.svc.DB, Provider: stubSearch{[]telephony.Available{
			{E164: rented, City: "Somewhere", MonthlyCost: Cost},
			{E164: pricier, City: "Somewhere", MonthlyCost: Cost + 1},
			{E164: "+18765550103", City: "Kingston", MonthlyCost: Cost},
			{E164: "+1" + area + "9765555", City: "Somewhere", MonthlyCost: Cost},
		}}}
		other := e.rep(0)
		if _, err := e.svc.DB.Exec(ctx, `INSERT INTO numbers (user_id, number, provider_id, monthly_cost, monthly_price, renews_at)
			VALUES ($1, $2, 'x', 1, 2, now() + interval '1 month')`, other, rented); err != nil {
			t.Fatal(err)
		}
		got, err := s.Search(ctx, user, "US", area)
		if err != nil || len(got) != 0 {
			t.Fatalf("search = %+v, %v; want none", got, err)
		}
	})

	t.Run("rate limit", func(t *testing.T) {
		busy := e.rep(0)
		for i := 0; i < searchesPerHour; i++ {
			if _, err := e.svc.Search(ctx, busy, "US", "646"); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := e.svc.Search(ctx, busy, "US", "646"); !errors.Is(err, ErrTooManyTries) {
			t.Fatalf("over the limit: %v", err)
		}
	})

	t.Run("no provider set up", func(t *testing.T) {
		s := &Service{DB: e.svc.DB}
		if _, err := s.Search(ctx, user, "US", "646"); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("no provider: %v", err)
		}
	})
}

type stubSearch struct{ found []telephony.Available }

func (s stubSearch) Search(context.Context, string, string, int) ([]telephony.Available, error) {
	return s.found, nil
}
func (stubSearch) Order(context.Context, string) (telephony.Ordered, error) {
	return telephony.Ordered{}, telephony.ErrProvider
}
func (stubSearch) Release(context.Context, string) error { return nil }

func TestRent(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	user := e.rep(10 * dollar)

	first := e.rent(user)
	if !first.Default || first.MonthlyPrice != Price() || first.City != "New York, NY" || first.CancelOn != nil {
		t.Fatalf("first number = %+v", first)
	}
	if want := platform.AddMonths(platform.ToDate(time.Now()), 1, time.Now().UTC().Day()); !first.RenewsOn.Equal(want) {
		t.Errorf("renews on %s, want %s", first.RenewsOn, want)
	}
	if got := e.balance(user); got != 10*dollar-Price() {
		t.Fatalf("balance = %d, want $8.50", got)
	}
	var desc string
	_ = e.svc.DB.QueryRow(ctx, `SELECT description FROM ledger_entries WHERE user_id = $1 AND type = 'number'`, user).Scan(&desc)
	if desc != "Number "+Pretty(first.E164)+", first month" {
		t.Errorf("ledger line = %q", desc)
	}
	second := e.rent(user)
	if second.Default {
		t.Fatal("only the first number is the default")
	}
	all, _ := e.svc.List(ctx, user)
	if len(all) != 2 || all[0].ID != first.ID {
		t.Fatalf("list = %+v", all)
	}

	t.Run("refused", func(t *testing.T) {
		poor := e.rep(Price() - 1)
		found, _ := e.svc.Search(ctx, poor, "US", nextArea())
		if _, err := e.svc.Rent(ctx, poor, RentInput{E164: found[0].E164, Country: "US"}); !errors.Is(err, ErrLowBalance) {
			t.Fatalf("low balance: %v", err)
		}
		if len(e.provider.Owned) != 2 {
			t.Fatalf("the provider was asked anyway: %v", e.provider.Owned)
		}
		for _, in := range []RentInput{
			{E164: "+18765550101", Country: "US"}, // Jamaica
			{E164: "+19005550101", Country: "US"}, // premium
			{E164: "6465550142", Country: "US"},   // not E.164
			{E164: "+16465550142", Country: "MX"},
		} {
			if _, err := e.svc.Rent(ctx, user, in); err == nil {
				t.Errorf("Rent(%+v) should be refused", in)
			}
		}
		if _, err := e.svc.Rent(ctx, user, RentInput{E164: first.E164, Country: "US"}); !errors.Is(err, ErrNumberGone) {
			t.Fatalf("a number already rented: %v", err)
		}
		taken := e.rep(5 * dollar)
		found, _ = e.svc.Search(ctx, taken, "US", nextArea())
		e.provider.Taken = map[string]bool{found[0].E164: true}
		if _, err := e.svc.Rent(ctx, taken, RentInput{E164: found[0].E164, Country: "US"}); !errors.Is(err, ErrNumberGone) {
			t.Fatalf("taken at the provider: %v", err)
		}
		e.provider.Fail = true
		if _, err := e.svc.Rent(ctx, taken, RentInput{E164: found[1].E164, Country: "US"}); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("provider down: %v", err)
		}
		e.provider.Fail = false
		if e.balance(taken) != 5*dollar {
			t.Fatal("a failed rent cost money")
		}
	})

	t.Run("money spent while ordering: the number goes back", func(t *testing.T) {
		racer := e.rep(Price())
		s := &Service{DB: e.svc.DB, Provider: spendWhileOrdering{e.provider, e, racer}}
		found, _ := e.svc.Search(ctx, racer, "US", nextArea())
		before := len(e.provider.Released)
		if _, err := s.Rent(ctx, racer, RentInput{E164: found[0].E164, Country: "US"}); !errors.Is(err, ErrLowBalance) {
			t.Fatalf("rent = %v", err)
		}
		if len(e.provider.Released) != before+1 || e.provider.Released[before] != found[0].E164 || e.provider.Owned[found[0].E164] {
			t.Fatalf("the number wasn't given back: %v", e.provider.Released)
		}
		var n int
		_ = e.svc.DB.QueryRow(ctx, `SELECT count(*) FROM numbers WHERE user_id = $1`, racer).Scan(&n)
		if n != 0 {
			t.Fatal("a number row was left behind")
		}
	})

	t.Run("limit", func(t *testing.T) {
		many := e.rep(100 * dollar)
		if _, err := e.svc.DB.Exec(ctx, `
			INSERT INTO numbers (user_id, number, provider_id, monthly_cost, monthly_price, renews_at)
			SELECT $1, '+1' || (200 + floor(random() * 700))::int || lpad(floor(random() * 10000000)::int::text, 7, '0'), 'x', 1, 2, now() + interval '1 month'
			FROM generate_series(1, $2::int) n`,
			many, MaxNumbers); err != nil {
			t.Fatal(err)
		}
		found, _ := e.svc.Search(ctx, many, "US", nextArea())
		if _, err := e.svc.Rent(ctx, many, RentInput{E164: found[0].E164, Country: "US"}); !errors.Is(err, ErrTooMany) {
			t.Fatalf("over the limit: %v", err)
		}
	})
}

// spendWhileOrdering spends the rep's money while the number is being
// ordered, as another tab might.
type spendWhileOrdering struct {
	*telephony.FakeNumbers
	e    *env
	user string
}

func (s spendWhileOrdering) Order(ctx context.Context, e164 string) (telephony.Ordered, error) {
	o, err := s.FakeNumbers.Order(ctx, e164)
	_ = platform.InTx(ctx, s.e.svc.DB, func(tx pgx.Tx) error {
		_, err := ledger.Debit(ctx, tx, ledger.Posting{UserID: s.user, Type: ledger.TypeCall, Amount: 1, Key: "test:spend:" + s.user})
		return err
	})
	return o, err
}

func TestDefaultCancelKeep(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	user := e.rep(10 * dollar)
	a, b := e.rent(user), e.rent(user)

	b2, err := e.svc.SetDefault(ctx, user, b.ID)
	if err != nil || !b2.Default {
		t.Fatalf("set default = %+v, %v", b2, err)
	}
	all, _ := e.svc.List(ctx, user)
	if all[0].ID != b.ID || all[1].Default {
		t.Fatalf("one default, listed first: %+v", all)
	}

	c, err := e.svc.Cancel(ctx, user, a.ID)
	if err != nil || c.CancelOn == nil || !c.CancelOn.Equal(a.RenewsOn) {
		t.Fatalf("cancel = %+v, %v; want cancel on the renewal date", c, err)
	}
	k, err := e.svc.Keep(ctx, user, a.ID)
	if err != nil || k.CancelOn != nil {
		t.Fatalf("keep = %+v, %v", k, err)
	}

	other := e.rep(0)
	for name, do := range map[string]func(context.Context, string, string) (Number, error){"default": e.svc.SetDefault, "cancel": e.svc.Cancel, "keep": e.svc.Keep} {
		if _, err := do(ctx, other, a.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s another rep's number: %v", name, err)
		}
		if _, err := do(ctx, user, "nope"); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s a bad id: %v", name, err)
		}
	}
}

// due moves a number's renewal date so RenewDue sees it.
func (e *env) due(id string, on time.Time) {
	e.t.Helper()
	if _, err := e.svc.DB.Exec(context.Background(), `UPDATE numbers SET renews_at = $2 WHERE id = $1`, id, on); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) number(id string) (renews time.Time, released bool, isDefault bool, failed bool) {
	e.t.Helper()
	var rel, fail *time.Time
	if err := e.svc.DB.QueryRow(context.Background(), `SELECT renews_at, released_at, is_default, renewal_failed_at FROM numbers WHERE id = $1`, id).
		Scan(&renews, &rel, &isDefault, &fail); err != nil {
		e.t.Fatal(err)
	}
	return platform.ToDate(renews), rel != nil, isDefault, fail != nil
}

func day(s string) time.Time {
	d, _ := time.Parse("2006-01-02", s)
	return d
}

func TestRenewals(t *testing.T) {
	ctx := context.Background()
	now := day("2026-11-04").Add(9 * time.Hour)

	t.Run("charges each month once, catching up", func(t *testing.T) {
		e := newEnv(t)
		user := e.rep(10 * dollar)
		n := e.rent(user)
		if _, err := e.svc.DB.Exec(ctx, `UPDATE numbers SET created_at = '2026-08-31' WHERE id = $1`, n.ID); err != nil {
			t.Fatal(err)
		}
		e.due(n.ID, day("2026-09-30"))
		before := e.balance(user)
		if _, err := e.svc.RenewDue(ctx, now); err != nil {
			t.Fatal(err)
		}
		renews, released, _, _ := e.number(n.ID)
		if !renews.Equal(day("2026-11-30")) || released {
			t.Fatalf("renews %s released %v; want 30 Nov after catching up Sep 30 and Oct 31", renews, released)
		}
		if got := before - e.balance(user); got != 2*Price() {
			t.Fatalf("charged %d, want two months", got)
		}
		if _, err := e.svc.RenewDue(ctx, now); err != nil {
			t.Fatal(err)
		}
		if got := before - e.balance(user); got != 2*Price() {
			t.Fatalf("a second run charged again: %d", got)
		}
	})

	t.Run("a cancelled number is released on its date, and the default moves", func(t *testing.T) {
		e := newEnv(t)
		user := e.rep(10 * dollar)
		a, b := e.rent(user), e.rent(user)
		e.due(a.ID, day("2026-11-04"))
		e.due(b.ID, day("2026-11-20"))
		if _, err := e.svc.Cancel(ctx, user, a.ID); err != nil {
			t.Fatal(err)
		}
		before := e.balance(user)
		res, err := e.svc.RenewDue(ctx, now)
		if err != nil || res.Released < 1 {
			t.Fatalf("res = %+v, %v", res, err)
		}
		_, released, _, _ := e.number(a.ID)
		_, _, bDefault, _ := e.number(b.ID)
		if !released || !bDefault || e.balance(user) != before {
			t.Fatalf("released %v, b default %v, charged %d", released, bDefault, before-e.balance(user))
		}
		if e.provider.Owned[a.E164] {
			t.Fatal("the provider still has the number")
		}
		left, _ := e.svc.List(ctx, user)
		if len(left) != 1 || left[0].ID != b.ID {
			t.Fatalf("list = %+v", left)
		}
	})

	t.Run("can't pay: warn, wait 3 days, then release", func(t *testing.T) {
		e := newEnv(t)
		user := e.rep(Price())
		n := e.rent(user)
		e.due(n.ID, day("2026-11-04"))
		res, _ := e.svc.RenewDue(ctx, now)
		_, released, _, failed := e.number(n.ID)
		if res.Warned < 1 || released || !failed {
			t.Fatalf("res %+v released %v failed %v", res, released, failed)
		}
		var email string
		_ = e.svc.DB.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, user).Scan(&email)
		if m, ok := e.mail.LastEmail(email); !ok || !strings.Contains(m.Text, "by 7 Nov") {
			t.Fatalf("warning email = %+v", m)
		}

		_, _ = e.svc.RenewDue(ctx, now.Add(2*24*time.Hour))
		if _, released, _, _ := e.number(n.ID); released {
			t.Fatal("released during the grace period")
		}
		_, _ = e.svc.RenewDue(ctx, now.Add(3*24*time.Hour))
		if _, released, _, _ := e.number(n.ID); !released {
			t.Fatal("not released after the grace period")
		}
		if m, _ := e.mail.LastEmail(email); !strings.Contains(m.Subject, "was released") {
			t.Fatalf("release email = %+v", m)
		}
		if e.balance(user) != 0 {
			t.Fatalf("balance = %d", e.balance(user))
		}
	})

	t.Run("topping up during grace renews it", func(t *testing.T) {
		e := newEnv(t)
		user := e.rep(Price())
		n := e.rent(user)
		e.due(n.ID, day("2026-11-04"))
		_, _ = e.svc.RenewDue(ctx, now)
		e.topUp(user, 5*dollar)
		_, _ = e.svc.RenewDue(ctx, now.Add(24*time.Hour))
		renews, released, _, failed := e.number(n.ID)
		if released || failed || !renews.After(day("2026-11-04")) {
			t.Fatalf("renews %s released %v failed %v", renews, released, failed)
		}
	})

	t.Run("provider down: release waits for the next run", func(t *testing.T) {
		e := newEnv(t)
		user := e.rep(10 * dollar)
		n := e.rent(user)
		e.due(n.ID, day("2026-11-04"))
		_, _ = e.svc.Cancel(ctx, user, n.ID)
		e.provider.Fail = true
		_, _ = e.svc.RenewDue(ctx, now)
		if _, released, _, _ := e.number(n.ID); released {
			t.Fatal("marked released though the provider still has it")
		}
		e.provider.Fail = false
		_, _ = e.svc.RenewDue(ctx, now)
		if _, released, _, _ := e.number(n.ID); !released {
			t.Fatal("not released on the next run")
		}
	})
}

func TestHTTP(t *testing.T) {
	e := newEnv(t)
	confirmed := auth.User{ID: e.rep(5 * dollar), EmailConfirmed: true, PhoneConfirmed: true}
	unconfirmed := auth.User{ID: e.rep(0)}
	users := map[string]auth.User{confirmed.ID: confirmed, unconfirmed.ID: unconfirmed}
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

	call := func(user, method, path string, body any) (int, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req, _ := http.NewRequest(method, srv.URL+path, &buf)
		req.Header.Set("X-Test-User", user)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out := map[string]any{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}

	if status, _ := call("", http.MethodGet, "/numbers", nil); status != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", status)
	}
	area := nextArea()
	if status, _ := call(unconfirmed.ID, http.MethodGet, "/numbers/available?country=US&area_code="+area, nil); status != http.StatusForbidden {
		t.Fatalf("unconfirmed search: %d", status)
	}
	status, body := call(confirmed.ID, http.MethodGet, "/numbers/available?country=US&area_code="+area, nil)
	if status != 200 || len(body["numbers"].([]any)) == 0 || body["monthly_price_microdollars"] != 1_500_000.0 {
		t.Fatalf("search: %d %v", status, body)
	}
	if status, body := call(confirmed.ID, http.MethodGet, "/numbers/available?country=US&area_code=12", nil); status != 422 || body["code"] != "invalid_area_code" {
		t.Fatalf("bad area code: %d %v", status, body)
	}
	pick := body["numbers"].([]any)[0].(map[string]any)

	status, body = call(confirmed.ID, http.MethodPost, "/numbers", map[string]any{"number": pick["number"], "city": "Somewhere, NY", "country": "US"})
	if status != http.StatusCreated || body["is_default"] != true || body["cancel_on"] != nil || body["renews_on"] == "" {
		t.Fatalf("rent: %d %v", status, body)
	}
	id := body["id"].(string)
	if status, body := call(confirmed.ID, http.MethodPost, "/numbers", map[string]any{"number": pick["number"], "country": "US"}); status != 409 || body["code"] != "number_gone" {
		t.Fatalf("rent twice: %d %v", status, body)
	}

	status, body = call(confirmed.ID, http.MethodGet, "/numbers", nil)
	if status != 200 || len(body["numbers"].([]any)) != 1 || body["monthly_total_microdollars"] != 1_500_000.0 {
		t.Fatalf("list: %d %v", status, body)
	}
	if status, body := call(confirmed.ID, http.MethodDelete, "/numbers/"+id, nil); status != 200 || body["cancel_on"] == nil {
		t.Fatalf("cancel: %d %v", status, body)
	}
	if _, body := call(confirmed.ID, http.MethodGet, "/numbers", nil); body["monthly_total_microdollars"] != 0.0 {
		t.Fatalf("a cancelled number doesn't count toward next month: %v", body)
	}
	if status, body := call(confirmed.ID, http.MethodPost, "/numbers/"+id+"/keep", nil); status != 200 || body["cancel_on"] != nil {
		t.Fatalf("keep: %d %v", status, body)
	}
	if status, body := call(confirmed.ID, http.MethodPut, "/numbers/"+id+"/default", nil); status != 200 || body["is_default"] != true {
		t.Fatalf("default: %d %v", status, body)
	}

	poor := auth.User{ID: e.rep(0), EmailConfirmed: true, PhoneConfirmed: true}
	users[poor.ID] = poor
	_, found := call(poor.ID, http.MethodGet, "/numbers/available?country=CA&area_code=416", nil)
	next := found["numbers"].([]any)[0].(map[string]any)["number"]
	if status, body := call(poor.ID, http.MethodPost, "/numbers", map[string]any{"number": next, "country": "CA"}); status != http.StatusPaymentRequired || body["code"] != "low_balance" {
		t.Fatalf("low balance: %d %v", status, body)
	}
}
