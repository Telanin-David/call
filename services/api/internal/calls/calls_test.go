package calls

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/telephony"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

const (
	dollar   = 1_000_000
	freeRate = 25_000 // $0.025 a minute to the US on Free
)

// 5 Oct 2026, 15:00 UTC: 11 am in New York, 8 am in Los Angeles.
var morning = time.Date(2026, 10, 5, 15, 0, 0, 0, time.UTC)

type env struct {
	t     *testing.T
	svc   *Service
	fake  *telephony.FakeCalls
	clock time.Time
}

func newEnv(t *testing.T) *env {
	t.Helper()
	e := &env{t: t, fake: telephony.NewFakeCalls(), clock: morning}
	e.svc = &Service{DB: testdb.Pool(t), Provider: e.fake, Now: func() time.Time { return e.clock }}
	return e
}

var seq int

// rep makes an active rep with money, a New York number and one list.
func (e *env) rep(balance int64) (auth.User, string) {
	e.t.Helper()
	ctx := context.Background()
	id := testdb.NewUser(e.t, e.svc.DB)
	u, err := auth.ScanUser(e.svc.DB.QueryRow(ctx, `
		UPDATE users SET email_confirmed = true, phone_confirmed = true, status = 'active', timezone = 'Africa/Lagos', created_at = $2
		WHERE id = $1 RETURNING `+auth.UserCols, id, morning.AddDate(0, 0, -3)))
	if err != nil {
		e.t.Fatal(err)
	}
	if balance > 0 {
		e.money(u.ID, balance)
	}
	number := randomNumber("646")
	if _, err := e.svc.DB.Exec(ctx, `INSERT INTO numbers (user_id, number, provider_id, monthly_cost, monthly_price, is_default, renews_at)
		VALUES ($1, $2, 'x', 1, 2, true, now() + interval '1 month')`, u.ID, number); err != nil {
		e.t.Fatal(err)
	}
	var list string
	if err := e.svc.DB.QueryRow(ctx, `INSERT INTO lead_lists (user_id, name) VALUES ($1, 'October') RETURNING id`, u.ID).Scan(&list); err != nil {
		e.t.Fatal(err)
	}
	return u, list
}

// randomNumber is a number in an area code that no earlier test run has
// rented (the test database keeps rows between runs).
func randomNumber(area string) string {
	seq++
	return fmt.Sprintf("+1%s%07d", area, 5000000+(time.Now().Nanosecond()/1000+seq*7919)%4000000)
}

func (e *env) money(userID string, amount int64) {
	e.t.Helper()
	seq++
	err := platform.InTx(context.Background(), e.svc.DB, func(tx pgx.Tx) error {
		_, err := ledger.Credit(context.Background(), tx, ledger.Posting{UserID: userID, Type: ledger.TypeTopUp, Amount: amount,
			Key: fmt.Sprintf("test:calls:%s:%d:%d", userID, seq, time.Now().UnixNano())})
		return err
	})
	if err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) lead(userID, list, number, first string) string {
	e.t.Helper()
	var id string
	if err := e.svc.DB.QueryRow(context.Background(), `INSERT INTO leads (list_id, user_id, first_name, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
		list, userID, first, number).Scan(&id); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *env) balance(userID string) int64 {
	e.t.Helper()
	b, err := ledger.Balance(context.Background(), e.svc.DB, userID)
	if err != nil {
		e.t.Fatal(err)
	}
	return b
}

// event plays a signed provider event for a call, through the signature check.
func (e *env) event(c Started, typ telephony.EventType, at time.Time, to string) {
	e.t.Helper()
	if to == "" {
		to = c.To
	}
	body, h := e.fake.Event(telephony.CallEvent{Type: typ, CallControlID: "cc-" + c.CallID, ClientState: c.ClientState, From: c.From, To: to, At: at})
	ev, err := e.fake.ParseEvent(h, body, at)
	if err != nil {
		e.t.Fatal(err)
	}
	if err := e.svc.HandleEvent(context.Background(), ev); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) call(id string) Call {
	e.t.Helper()
	var userID string
	_ = e.svc.DB.QueryRow(context.Background(), `SELECT user_id FROM calls WHERE id = $1`, id).Scan(&userID)
	c, err := e.svc.Get(context.Background(), userID, id)
	if err != nil {
		e.t.Fatal(err)
	}
	return c
}

func TestDailyLimit(t *testing.T) {
	signup := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		plan     string
		verified bool
		at       time.Time
		want     int
		limited  bool
	}{
		{"free", false, signup.AddDate(0, 0, 10), 30, true},
		{"free", false, signup.AddDate(0, 1, 0), 25, true},
		{"free", false, signup.AddDate(0, 2, -1), 25, true},
		{"free", false, signup.AddDate(0, 2, 0), 10, true},
		{"free", false, signup.AddDate(1, 0, 0), 10, true},
		{"free", true, signup.AddDate(1, 0, 0), 30, true},
		{"starter", false, signup, 120, true},
		{"starter", true, signup, 500, true},
		{"pro", false, signup, 0, false},
	}
	for _, tt := range tests {
		got, limited := DailyLimit(tt.plan, tt.verified, signup, tt.at)
		if got != tt.want || limited != tt.limited {
			t.Errorf("DailyLimit(%s, verified %v, %s) = %d %v, want %d %v", tt.plan, tt.verified, tt.at.Format("2006-01-02"), got, limited, tt.want, tt.limited)
		}
	}
}

func TestCallLifecycle(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	lena := e.lead(u.ID, list, "+12125550101", "Lena")

	st, err := e.svc.Start(ctx, u, lena)
	if err != nil {
		t.Fatal(err)
	}
	if st.PricePerMin != freeRate || st.Held != freeRate || st.Token == "" || len(st.ClientState) < 20 || st.HerTimeZone != "America/New_York" || st.Lead.Name() != "Lena" {
		t.Fatalf("started = %+v", st)
	}
	if got := e.balance(u.ID); got != 10*dollar-freeRate {
		t.Fatalf("balance after the hold = %d, want $10 minus one minute", got)
	}
	var attempts int
	var status, cred string
	_ = e.svc.DB.QueryRow(ctx, `SELECT attempts, status FROM leads WHERE id = $1`, lena).Scan(&attempts, &status)
	_ = e.svc.DB.QueryRow(ctx, `SELECT telnyx_credential_id FROM users WHERE id = $1`, u.ID).Scan(&cred)
	if attempts != 1 || status != "called" || cred == "" {
		t.Fatalf("lead attempts %d status %q, credential %q", attempts, status, cred)
	}
	if _, err := e.svc.Start(ctx, u, lena); !errors.Is(err, ErrOnACall) {
		t.Fatalf("a second call at once: %v", err)
	}

	e.event(st, telephony.EventInitiated, morning, "")
	if c := e.call(st.CallID); c.Status != "ringing" || c.ProviderID != "cc-"+st.CallID {
		t.Fatalf("after initiated: %+v", c)
	}
	answered := morning.Add(5 * time.Second)
	e.event(st, telephony.EventAnswered, answered, "")
	e.event(st, telephony.EventAnswered, answered.Add(time.Minute), "") // a repeat changes nothing
	if c := e.call(st.CallID); c.Status != "answered" || !c.AnsweredAt.Equal(answered) {
		t.Fatalf("after answered: %+v", c)
	}

	// The ticker holds the next minute half a minute before it's needed.
	for _, s := range []int{10, 31, 45, 91, 100} {
		e.clock = answered.Add(time.Duration(s) * time.Second)
		if _, err := e.svc.Tick(ctx); err != nil {
			t.Fatal(err)
		}
	}
	h, _ := ledger.GetHold(ctx, e.svc.DB, e.call(st.CallID).HoldID)
	if h.Amount != 3*freeRate {
		t.Fatalf("hold after 100 s = %d, want 3 minutes", h.Amount)
	}

	ended := answered.Add(125 * time.Second)
	e.event(st, telephony.EventHangup, ended, "")
	e.event(st, telephony.EventHangup, ended.Add(time.Second), "") // a repeat bills nothing more
	c := e.call(st.CallID)
	want := int64((freeRate*125 + 59) / 60) // per second, rounded up
	if c.Status != "ended" || c.Seconds != 125 || c.Cost != want {
		t.Fatalf("ended call = %+v, want 125 s costing %d", c, want)
	}
	if got := e.balance(u.ID); got != 10*dollar-want {
		t.Fatalf("balance = %d, want $10 minus %d: the unused hold comes back", got, want)
	}
	var line string
	_ = e.svc.DB.QueryRow(ctx, `SELECT description FROM ledger_entries WHERE user_id = $1 AND type = 'call'`, u.ID).Scan(&line)
	if line != "Call to +1 (212) 555-0101, 2:05" {
		t.Errorf("ledger line = %q", line)
	}
}

func TestUnansweredAndWrongCalls(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(5 * dollar)

	t.Run("never answered costs nothing", func(t *testing.T) {
		st, err := e.svc.Start(ctx, u, e.lead(u.ID, list, "+12125550102", "Tom"))
		if err != nil {
			t.Fatal(err)
		}
		e.event(st, telephony.EventInitiated, morning, "")
		e.event(st, telephony.EventHangup, morning.Add(30*time.Second), "")
		if c := e.call(st.CallID); c.Status != "ended" || c.Cost != 0 || e.balance(u.ID) != 5*dollar {
			t.Fatalf("call %+v, balance %d", c, e.balance(u.ID))
		}
	})

	t.Run("the browser dialling another number is hung up", func(t *testing.T) {
		st, err := e.svc.Start(ctx, u, e.lead(u.ID, list, "+12125550103", "Amy"))
		if err != nil {
			t.Fatal(err)
		}
		e.event(st, telephony.EventInitiated, morning, "+19005550123")
		if c := e.call(st.CallID); c.Status != "ended" || c.HangupCause != "wrong_number_dialled" || e.balance(u.ID) != 5*dollar {
			t.Fatalf("call %+v", c)
		}
		if n := len(e.fake.Hung); n == 0 || e.fake.Hung[n-1] != "cc-"+st.CallID {
			t.Fatalf("not hung up at the provider: %v", e.fake.Hung)
		}
	})

	t.Run("using another call's id as the client state is hung up", func(t *testing.T) {
		victim, err := e.svc.Start(ctx, u, e.lead(u.ID, list, "+12125550110", "Vic"))
		if err != nil {
			t.Fatal(err)
		}
		body, h := e.fake.Event(telephony.CallEvent{Type: telephony.EventInitiated, CallControlID: "cc-thief-" + victim.CallID, ClientState: victim.CallID, To: victim.To, At: morning})
		ev, _ := e.fake.ParseEvent(h, body, morning)
		if err := e.svc.HandleEvent(ctx, ev); err != nil {
			t.Fatal(err)
		}
		if e.fake.Hung[len(e.fake.Hung)-1] != "cc-thief-"+victim.CallID {
			t.Fatalf("hung = %v", e.fake.Hung)
		}
		if c := e.call(victim.CallID); c.Status != "dialing" || c.ProviderID != "" {
			t.Fatalf("the real call was touched: %+v", c)
		}
		if _, err := e.svc.Hangup(ctx, u.ID, victim.CallID); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("a call we didn't start is hung up", func(t *testing.T) {
		body, h := e.fake.Event(telephony.CallEvent{Type: telephony.EventInitiated, CallControlID: "cc-stranger", To: "+19005550123", At: morning})
		ev, _ := e.fake.ParseEvent(h, body, morning)
		if err := e.svc.HandleEvent(ctx, ev); err != nil {
			t.Fatal(err)
		}
		if e.fake.Hung[len(e.fake.Hung)-1] != "cc-stranger" {
			t.Fatalf("hung = %v", e.fake.Hung)
		}
	})

	t.Run("dialled but never connected: closed by the ticker", func(t *testing.T) {
		st, err := e.svc.Start(ctx, u, e.lead(u.ID, list, "+12125550104", "Raj"))
		if err != nil {
			t.Fatal(err)
		}
		e.clock = morning.Add(neverConnected + time.Second)
		if _, err := e.svc.Tick(ctx); err != nil {
			t.Fatal(err)
		}
		e.clock = morning
		if c := e.call(st.CallID); c.Status != "ended" || c.HangupCause != "never_connected" || e.balance(u.ID) != 5*dollar {
			t.Fatalf("call %+v balance %d", c, e.balance(u.ID))
		}
	})

	t.Run("the rep hangs up before it connects", func(t *testing.T) {
		st, err := e.svc.Start(ctx, u, e.lead(u.ID, list, "+12125550105", "Kim"))
		if err != nil {
			t.Fatal(err)
		}
		c, err := e.svc.Hangup(ctx, u.ID, st.CallID)
		if err != nil || c.Status != "ended" || e.balance(u.ID) != 5*dollar {
			t.Fatalf("hangup = %+v, %v", c, err)
		}
	})
}

func TestBalanceRunsOut(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(freeRate + freeRate/2) // a minute and a half
	st, err := e.svc.Start(ctx, u, e.lead(u.ID, list, "+12125550106", "Lena"))
	if err != nil {
		t.Fatal(err)
	}
	e.event(st, telephony.EventInitiated, morning, "")
	e.event(st, telephony.EventAnswered, morning, "")

	e.clock = morning.Add(31 * time.Second)
	res, _ := e.svc.Tick(ctx)
	if c := e.call(st.CallID); res.Warned != 1 || c.LowBalanceAt == nil {
		t.Fatalf("30 s before the money runs out: res %+v, call %+v", res, c)
	}
	e.clock = morning.Add(62 * time.Second) // the tick lands a little after the minute
	res, _ = e.svc.Tick(ctx)
	c := e.call(st.CallID)
	if res.Ended != 1 || c.Status != "ended" || c.HangupCause != "balance_ran_out" || c.Seconds != 60 || c.Cost != freeRate {
		t.Fatalf("res %+v, call %+v: want ended, billed exactly the minute held", res, c)
	}
	if e.fake.Hung[len(e.fake.Hung)-1] != "cc-"+st.CallID {
		t.Fatal("not hung up at the provider")
	}
	if got := e.balance(u.ID); got != freeRate/2 {
		t.Fatalf("balance = %d: never below what was there", got)
	}
}

func TestBlocked(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	_, _ = e.svc.DB.Exec(ctx, `INSERT INTO rate_cards (country, prefix, cost_per_min) VALUES ('GH', '233', 100000) ON CONFLICT DO NOTHING`)

	try := func(number string) error {
		_, err := e.svc.Start(ctx, u, e.lead(u.ID, list, number, "Rosa"))
		return err
	}
	if _, err := e.svc.DB.Exec(ctx, `INSERT INTO dnc_entries (user_id, phone) VALUES ($1, '+12125550201')`, u.ID); err != nil {
		t.Fatal(err)
	}
	var b *Blocked
	if err := try("+12125550201"); !errors.As(err, &b) || b.Code != "do_not_call" || b.Title != "Skipped Rosa" || b.Action != "skip" {
		t.Fatalf("do-not-call: %#v", err)
	}
	if err := try("+19005550123"); !errors.Is(err, errPremium) {
		t.Fatalf("premium: %v", err)
	}
	if err := try("+18765550123"); !errors.Is(err, errNoRate) {
		t.Fatalf("Jamaica has no rate card: %v", err)
	}
	for i := 0; i < MaxTries; i++ {
		if _, err := e.svc.DB.Exec(ctx, `INSERT INTO calls (user_id, to_number, status, started_at) VALUES ($1, '+12125550202', 'ended', $2)`, u.ID, morning.AddDate(0, 0, -1)); err != nil {
			t.Fatal(err)
		}
	}
	if err := try("+12125550202"); !errors.As(err, &b) || b.Code != "three_tries" || b.Title != "You can't call Rosa again" {
		t.Fatalf("three tries: %v", err)
	}

	e.clock = time.Date(2026, 10, 5, 2, 14, 0, 0, time.UTC) // 10:14 pm in New York
	if err := try("+12125550203"); !errors.As(err, &b) || b.Code != "calling_hours" || b.Title != "It's 10:14 pm for Rosa" {
		t.Fatalf("calling hours: %#v", err)
	}
	// 709 is Newfoundland and Labrador: at 11:00 UTC it's 8:30 am in St John's
	// but 7 am in Labrador, so the call waits, and says the Labrador time.
	e.clock = time.Date(2026, 10, 5, 11, 0, 0, 0, time.UTC)
	if err := try("+17095550142"); !errors.As(err, &b) || b.Title != "It's 7:00 am for Rosa" {
		t.Fatalf("two zones: %#v", err)
	}
	e.clock = morning

	t.Run("abroad cap before the ID check", func(t *testing.T) {
		if _, err := e.svc.DB.Exec(ctx, `INSERT INTO calls (user_id, to_number, status, cost_microdollars, started_at) VALUES ($1, '+233245550100', 'ended', $2, $3)`,
			u.ID, AbroadPerDay-100_000, morning.Add(-time.Hour)); err != nil {
			t.Fatal(err)
		}
		// Accra is 3 pm: in hours. $2.90 spent + $0.25 for the first minute > $3.
		if err := try("+233245550190"); !errors.Is(err, errAbroadCap) {
			t.Fatalf("abroad cap: %v", err)
		}
	})

	t.Run("daily limit", func(t *testing.T) {
		v, vlist := e.rep(10 * dollar)
		if _, err := e.svc.DB.Exec(ctx, `INSERT INTO calls (user_id, to_number, status, started_at) SELECT $1, '+12125550300', 'ended', $2 FROM generate_series(1, 30)`,
			v.ID, morning.Add(-time.Hour)); err != nil {
			t.Fatal(err)
		}
		_, err := e.svc.Start(ctx, v, e.lead(v.ID, vlist, "+12125550204", "Ann"))
		if !errors.As(err, &b) || b.Code != "daily_limit" || b.Title != "You've used your 30 dials for today" || b.Action != "upgrade" {
			t.Fatalf("daily limit: %#v", err)
		}
		// Yesterday's calls (Lagos time: the day began at 23:00 UTC) don't count.
		if _, err := e.svc.DB.Exec(ctx, `UPDATE calls SET started_at = $2 WHERE user_id = $1`, v.ID, morning.Add(-16*time.Hour-time.Second)); err != nil {
			t.Fatal(err)
		}
		if _, err := e.svc.Start(ctx, v, e.lead(v.ID, vlist, "+12125550205", "Ann")); err != nil {
			t.Fatalf("a new day: %v", err)
		}
	})

	t.Run("low balance, no number, suspended, someone else's lead", func(t *testing.T) {
		poor, plist := e.rep(freeRate - 1)
		_, err := e.svc.Start(ctx, poor, e.lead(poor.ID, plist, "+12125550206", "Ann"))
		if !errors.As(err, &b) || b.Code != "low_balance" || b.Status != http.StatusPaymentRequired || b.Message != "Your balance is $0.02. That is not enough to start a call." {
			t.Fatalf("low balance: %#v", err)
		}
		var n int
		_ = e.svc.DB.QueryRow(ctx, `SELECT count(*) FROM calls WHERE user_id = $1`, poor.ID).Scan(&n)
		if n != 0 {
			t.Fatal("a refused call left a row behind")
		}

		bare, blist := e.rep(dollar)
		_, _ = e.svc.DB.Exec(ctx, `UPDATE numbers SET released_at = now() WHERE user_id = $1`, bare.ID)
		if _, err := e.svc.Start(ctx, bare, e.lead(bare.ID, blist, "+12125550207", "Ann")); !errors.Is(err, ErrNoNumber) {
			t.Fatalf("no number: %v", err)
		}
		_, _ = e.svc.DB.Exec(ctx, `UPDATE users SET status = 'suspended' WHERE id = $1`, bare.ID)
		if _, err := e.svc.Start(ctx, bare, e.lead(bare.ID, blist, "+12125550208", "Ann")); !errors.Is(err, ErrSuspended) {
			t.Fatalf("suspended: %v", err)
		}
		if _, err := e.svc.Start(ctx, poor, e.lead(u.ID, list, "+12125550209", "Ann")); !errors.Is(err, ErrLeadNotFound) {
			t.Fatalf("another rep's lead: %v", err)
		}
	})
}

func TestPickNumber(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	// The default is the 646 number; add Los Angeles and Chicago ones.
	for _, n := range []string{randomNumber("213"), randomNumber("312")} {
		if _, err := e.svc.DB.Exec(ctx, `INSERT INTO numbers (user_id, number, provider_id, monthly_cost, monthly_price, renews_at) VALUES ($1, $2, 'x', 1, 2, now())`, u.ID, n); err != nil {
			t.Fatal(err)
		}
	}
	tests := []struct{ to, wantArea string }{
		{"+12135550401", "213"}, // same area code
		{"+13105550402", "213"}, // same time zone (Los Angeles)
		{"+16305550403", "312"}, // same time zone (Chicago)
		{"+14165550404", "646"}, // Toronto: no match, the default
	}
	for _, tt := range tests {
		e.clock = morning.Add(3 * time.Hour) // in hours everywhere
		st, err := e.svc.Start(ctx, u, e.lead(u.ID, list, tt.to, "Lee"))
		if err != nil {
			t.Fatalf("%s: %v", tt.to, err)
		}
		if st.From[2:5] != tt.wantArea {
			t.Errorf("calling %s goes out from %s, want area %s", tt.to, st.From, tt.wantArea)
		}
		if _, err := e.svc.Hangup(ctx, u.ID, st.CallID); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOutcome(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	lead := e.lead(u.ID, list, "+12125550501", "Lena")
	st, _ := e.svc.Start(ctx, u, lead)

	if _, err := e.svc.SaveOutcome(ctx, u.ID, st.CallID, OutcomeInput{Outcome: Interested}); !errors.Is(err, ErrCallLive) {
		t.Fatalf("before it ends: %v", err)
	}
	e.event(st, telephony.EventInitiated, morning, "")
	e.event(st, telephony.EventAnswered, morning, "")
	e.event(st, telephony.EventHangup, morning.Add(40*time.Second), "")

	for _, bad := range []OutcomeInput{{Outcome: "maybe"}, {Outcome: DoNotCall, FollowUpAt: ptr(morning.AddDate(0, 0, 1))}, {Outcome: CallBack, FollowUpAt: ptr(morning.AddDate(2, 0, 0))}} {
		if _, err := e.svc.SaveOutcome(ctx, u.ID, st.CallID, bad); err == nil {
			t.Errorf("%+v should be refused", bad)
		}
	}

	tomorrow := morning.AddDate(0, 0, 1)
	c, err := e.svc.SaveOutcome(ctx, u.ID, st.CallID, OutcomeInput{Outcome: CallBack, Note: " After 3 pm her time ", FollowUpAt: &tomorrow})
	if err != nil || c.Outcome != "callback" || c.Note != "After 3 pm her time" {
		t.Fatalf("save = %+v, %v", c, err)
	}
	followups := func() (open int) {
		_ = e.svc.DB.QueryRow(ctx, `SELECT count(*) FROM followups WHERE lead_id = $1 AND NOT done`, lead).Scan(&open)
		return
	}
	leadStatus := func() (s string) {
		_ = e.svc.DB.QueryRow(ctx, `SELECT status FROM leads WHERE id = $1`, lead).Scan(&s)
		return
	}
	if followups() != 1 || leadStatus() != "callback" {
		t.Fatalf("follow-ups %d, lead %s", followups(), leadStatus())
	}

	// Undo: not interested replaces it and removes the follow-up.
	if _, err := e.svc.SaveOutcome(ctx, u.ID, st.CallID, OutcomeInput{Outcome: NotInterested}); err != nil {
		t.Fatal(err)
	}
	if followups() != 0 || leadStatus() != "done" {
		t.Fatalf("after undo: follow-ups %d, lead %s", followups(), leadStatus())
	}

	dnc := func() (n int) {
		_ = e.svc.DB.QueryRow(ctx, `SELECT count(*) FROM dnc_entries WHERE user_id = $1 AND phone = '+12125550501'`, u.ID).Scan(&n)
		return
	}
	if _, err := e.svc.SaveOutcome(ctx, u.ID, st.CallID, OutcomeInput{Outcome: DoNotCall}); err != nil || dnc() != 1 || leadStatus() != "dnc" {
		t.Fatalf("do not call: %v, dnc %d", err, dnc())
	}
	if _, err := e.svc.SaveOutcome(ctx, u.ID, st.CallID, OutcomeInput{Outcome: NoAnswer}); err != nil || dnc() != 0 {
		t.Fatalf("undo do not call: %v, dnc %d", err, dnc())
	}
	other, _ := e.rep(0)
	if _, err := e.svc.SaveOutcome(ctx, other.ID, st.CallID, OutcomeInput{Outcome: Interested}); !errors.Is(err, ErrCallNotFound) {
		t.Fatalf("another rep's call: %v", err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestHTTP(t *testing.T) {
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	lead := e.lead(u.ID, list, "+12125550601", "Lena")
	dnc := e.lead(u.ID, list, "+12125550602", "Jade")
	_, _ = e.svc.DB.Exec(context.Background(), `INSERT INTO dnc_entries (user_id, phone) VALUES ($1, '+12125550602')`, u.ID)

	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				if req.Header.Get("X-Test-User") == u.ID {
					req = req.WithContext(auth.WithUser(req.Context(), u))
				}
				next.ServeHTTP(w, req)
			})
		})
		e.svc.Routes(r)
		e.svc.DevRoutes(r)
	})
	e.svc.WebhookRoutes(r)
	srv := httptest.NewServer(r)
	defer srv.Close()

	call := func(method, path string, body any, h http.Header) (int, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		switch b := body.(type) {
		case []byte:
			buf.Write(b)
		case nil:
		default:
			_ = json.NewEncoder(&buf).Encode(b)
		}
		req, _ := http.NewRequest(method, srv.URL+path, &buf)
		for k, v := range h {
			req.Header[k] = v
		}
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

	status, body := call(http.MethodPost, "/calls", map[string]string{"lead_id": dnc}, nil)
	if status != 403 || body["code"] != "do_not_call" || body["title"] != "Skipped Jade" || body["action"] != "skip" {
		t.Fatalf("blocked: %d %v", status, body)
	}
	status, body = call(http.MethodPost, "/calls", map[string]string{"lead_id": lead}, nil)
	if status != 201 || body["token"] == "" || body["price_per_minute_microdollars"] != float64(freeRate) || body["lead_name"] != "Lena" {
		t.Fatalf("start: %d %v", status, body)
	}
	id := body["call_id"].(string)

	// Webhooks: a forged one is refused before anything else happens.
	good, h := e.fake.Event(telephony.CallEvent{Type: telephony.EventInitiated, CallControlID: "cc-http-" + id, ClientState: body["client_state"].(string), To: "+12125550601", At: morning})
	forged := bytes.Replace(good, []byte("+12125550601"), []byte("+12125550699"), 1)
	if status, _ := call(http.MethodPost, "/webhooks/telnyx", forged, h); status != http.StatusUnauthorized {
		t.Fatalf("forged webhook: %d", status)
	}
	if status, _ := call(http.MethodPost, "/webhooks/telnyx", good, h); status != 200 {
		t.Fatalf("webhook: %d", status)
	}
	if status, body := call(http.MethodGet, "/calls/"+id, nil, nil); status != 200 || body["status"] != "ringing" {
		t.Fatalf("get: %d %v", status, body)
	}

	if status, body := call(http.MethodPost, "/dev/calls/"+id+"/events/answered", nil, nil); status != 200 || body["status"] != "answered" {
		t.Fatalf("dev answered: %d %v", status, body)
	}
	e.clock = morning.Add(20 * time.Second)
	if status, body := call(http.MethodPost, "/dev/calls/"+id+"/events/hangup", nil, nil); status != 200 || body["status"] != "ended" || body["seconds"] != 20.0 {
		t.Fatalf("dev hangup: %d %v", status, body)
	}
	status, body = call(http.MethodPost, "/calls/"+id+"/outcome", map[string]any{"outcome": "callback", "note": "Thursday", "follow_up_at": morning.AddDate(0, 0, 3)}, nil)
	if status != 200 || body["outcome"] != "callback" || body["note"] != "Thursday" {
		t.Fatalf("outcome: %d %v", status, body)
	}

	// Lena calls back while the app is open on Starter.
	if _, err := e.svc.DB.Exec(context.Background(), `INSERT INTO subscriptions (user_id, plan_id, next_renewal) VALUES ($1, 'starter', '2026-11-05')`, u.ID); err != nil {
		t.Fatal(err)
	}
	if status, body := call(http.MethodGet, "/incoming", nil, nil); status != 200 || body["call"] != nil {
		t.Fatalf("nothing ringing: %d %v", status, body)
	}
	status, body = call(http.MethodPost, "/dev/incoming", map[string]string{"lead_id": lead}, nil)
	in, _ := body["call"].(map[string]any)
	if status != 201 || in["status"] != "ringing" {
		t.Fatalf("dev incoming: %d %v", status, body)
	}
	status, body = call(http.MethodGet, "/incoming", nil, nil)
	ringing, _ := body["call"].(map[string]any)
	l, _ := ringing["lead"].(map[string]any)
	last, _ := l["last_call"].(map[string]any)
	if status != 200 || ringing["id"] != in["id"] || ringing["caller"] != "+12125550601" || ringing["phone"] != "fake" || l["name"] != "Lena" || last["note"] != "Thursday" {
		t.Fatalf("ringing: %d %v", status, body)
	}
	if _, ok := ringing["client_state"]; ok {
		t.Error("the call's secret is sent to the app")
	}
	if status, body := call(http.MethodPost, "/dev/calls/"+in["id"].(string)+"/events/answered", nil, nil); status != 200 || body["status"] != "answered" {
		t.Fatalf("answer: %d %v", status, body)
	}
	if _, body := call(http.MethodGet, "/incoming", nil, nil); body["call"] != nil {
		t.Errorf("answered, still ringing: %v", body)
	}
	if status, body := call(http.MethodPost, "/calls/"+in["id"].(string)+"/hangup", nil, nil); status != 200 || body["status"] != "ended" {
		t.Fatalf("hang up: %d %v", status, body)
	}
}

func TestTodayFollowupsHistory(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	_, _ = e.svc.DB.Exec(ctx, `UPDATE lead_lists SET name = 'October leads' WHERE id = $1`, list)
	lena := e.lead(u.ID, list, "+12125550701", "Lena")
	mark := e.lead(u.ID, list, "+12125550702", "Mark")
	_ = e.lead(u.ID, list, "+12125550703", "Sara")

	// Yesterday (Lagos time): one call. Today: two calls, Lena interested.
	if _, err := e.svc.DB.Exec(ctx, `INSERT INTO calls (user_id, lead_id, to_number, status, seconds, cost_microdollars, outcome, started_at)
		VALUES ($1, $2, '+12125550702', 'ended', 30, 12500, 'no_answer', $3)`, u.ID, mark, morning.AddDate(0, 0, -1)); err != nil {
		t.Fatal(err)
	}
	for i, c := range []struct {
		lead, to string
		dur      time.Duration
		outcome  Outcome
		follow   *time.Time
	}{
		{mark, "+12125550702", 20 * time.Second, CallBack, ptr(morning.AddDate(0, 0, 3))},
		{lena, "+12125550701", 125 * time.Second, Interested, ptr(morning.Add(2 * time.Hour))},
	} {
		begin := morning.Add(time.Duration(i) * 5 * time.Minute)
		e.clock = begin
		st, err := e.svc.Start(ctx, u, c.lead)
		if err != nil {
			t.Fatal(err)
		}
		e.event(st, telephony.EventInitiated, begin, "")
		e.event(st, telephony.EventAnswered, begin, "")
		for s := 31 * time.Second; s < c.dur; s += 30 * time.Second {
			e.clock = e.clock.Add(30 * time.Second)
			_, _ = e.svc.Tick(ctx)
		}
		e.clock = begin.Add(c.dur)
		e.event(st, telephony.EventHangup, begin.Add(c.dur), "")
		if _, err := e.svc.SaveOutcome(ctx, u.ID, st.CallID, OutcomeInput{Outcome: c.outcome, Note: "note " + string(c.outcome), FollowUpAt: c.follow}); err != nil {
			t.Fatal(err)
		}
	}

	e.clock = morning.Add(10 * time.Minute)
	today, err := e.svc.Today(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	lenaCost := int64((freeRate*125 + 59) / 60)
	if today.DialsToday != 2 || today.DialLimit == nil || *today.DialLimit != 30 || today.Today.TalkSeconds != 145 || today.Today.Interested != 1 {
		t.Fatalf("today = %+v", today)
	}
	if today.Today.Spent != lenaCost+int64((freeRate*20+59)/60) || today.Yesterday.Calls != 1 || today.Yesterday.Spent != 12500 {
		t.Fatalf("money: today %+v yesterday %+v", today.Today, today.Yesterday)
	}
	if today.DueCount != 1 || len(today.DueToday) != 1 || today.DueToday[0].Lead.Name != "Lena" || today.DueToday[0].LastNote != "note interested" {
		t.Fatalf("due = %d %+v", today.DueCount, today.DueToday)
	}
	if today.Ready == nil || today.Ready.Name != "October leads" || today.Ready.Left != 3 {
		t.Fatalf("ready list = %+v", today.Ready)
	}

	due, counts, err := e.svc.Followups(ctx, u.ID, "week")
	if err != nil || counts != (FollowupCounts{Today: 1, Week: 1}) || len(due) != 1 || due[0].Lead.Name != "Mark" || due[0].LastOutcome != "callback" || due[0].Lead.HerTimeZone != "America/New_York" {
		t.Fatalf("week = %+v %+v %v", due, counts, err)
	}
	if err := e.svc.FollowupDone(ctx, u.ID, due[0].ID); err != nil {
		t.Fatal(err)
	}
	other, _ := e.rep(0)
	if err := e.svc.FollowupDone(ctx, other.ID, today.DueToday[0].ID); !errors.Is(err, ErrFollowupNotFound) {
		t.Fatalf("another rep's follow-up: %v", err)
	}
	if _, counts, _ := e.svc.Followups(ctx, u.ID, "today"); counts != (FollowupCounts{Today: 1}) {
		t.Fatalf("after done: %+v", counts)
	}

	all, next, err := e.svc.History(ctx, u.ID, "", "", nil, 2)
	if err != nil || len(all) != 2 || next == nil || all[0].Lead == nil || all[0].Lead.Name != "Lena" || all[0].Seconds != 125 || all[0].Cost != lenaCost {
		t.Fatalf("history page 1 = %+v %v %v", all, next, err)
	}
	cur, err := ParseHistoryCursor(next.String())
	if err != nil {
		t.Fatal(err)
	}
	rest, next, err := e.svc.History(ctx, u.ID, "", "", cur, 2)
	if err != nil || len(rest) != 1 || next != nil || rest[0].Outcome != "no_answer" {
		t.Fatalf("history page 2 = %+v %v %v", rest, next, err)
	}
	for _, tt := range []struct {
		outcome, q string
		want       int
	}{{"interested", "", 1}, {"", "mar", 2}, {"", "555-0701", 1}, {"", "nobody", 0}} {
		got, _, err := e.svc.History(ctx, u.ID, tt.outcome, tt.q, nil, 50)
		if err != nil || len(got) != tt.want {
			t.Errorf("History(%q, %q) = %d calls, %v; want %d", tt.outcome, tt.q, len(got), err, tt.want)
		}
	}
	if _, err := ParseHistoryCursor("%%%"); !errors.Is(err, ErrBadCursor) {
		t.Errorf("broken cursor: %v", err)
	}
	week, _ := e.svc.Week(ctx, u.ID)
	if week.Calls != 3 {
		t.Errorf("week = %+v", week)
	}
}
