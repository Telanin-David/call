package calls

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/rates"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

func TestQueue(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	db := e.svc.DB

	var script string
	if err := db.QueryRow(ctx, `INSERT INTO scripts (user_id, name, parts) VALUES ($1, 'Office cleaning', '[{"title":"Open","body":"Hi {first_name}"}]') RETURNING id`,
		u.ID).Scan(&script); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `UPDATE lead_lists SET script_id = $2 WHERE id = $1`, list, script); err != nil {
		t.Fatal(err)
	}
	ada := e.lead(u.ID, list, "+12125550701", "Ada")
	tried := e.lead(u.ID, list, "+12125550702", "Ben")
	dnc := e.lead(u.ID, list, "+12125550703", "Cy")
	done := e.lead(u.ID, list, "+12125550704", "Di")
	eve := e.lead(u.ID, list, "+12125550705", "Eve")
	for _, q := range []string{
		`UPDATE leads SET attempts = 3, status = 'called' WHERE id = '` + tried + `'`,
		`UPDATE leads SET status = 'done' WHERE id = '` + done + `'`,
		`INSERT INTO dnc_entries (user_id, phone) VALUES ('` + u.ID + `', '+12125550703')`,
	} {
		if _, err := db.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	_ = dnc

	// Eve was called yesterday and asked for a call back today.
	e.clock = morning.Add(-24 * time.Hour)
	st, err := e.svc.Start(ctx, u, eve)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Hangup(ctx, u.ID, st.CallID); err != nil {
		t.Fatal(err)
	}
	soon := morning.Add(time.Hour)
	if _, err := e.svc.SaveOutcome(ctx, u.ID, st.CallID, OutcomeInput{Outcome: CallBack, Note: "After 3 pm", FollowUpAt: &soon}); err != nil {
		t.Fatal(err)
	}
	e.clock = morning
	later := morning.Add(72 * time.Hour)
	if _, err := db.Exec(ctx, `INSERT INTO followups (user_id, lead_id, due_at) VALUES ($1, $2, $3)`, u.ID, ada, later); err != nil {
		t.Fatal(err)
	}

	ids := func(q Queue) []string {
		out := []string{}
		for _, l := range q.Leads {
			out = append(out, l.ID)
		}
		return out
	}
	same := func(got, want []string) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}

	t.Run("a list: callable leads, never-called first", func(t *testing.T) {
		q, err := e.svc.Queue(ctx, u.ID, QueueFor{ListID: list})
		if err != nil {
			t.Fatal(err)
		}
		if !same(ids(q), []string{ada, eve}) {
			t.Fatalf("leads = %v, want Ada then Eve (not 3 tries, do-not-call or done)", ids(q))
		}
		if q.Title != "October" || q.ListID != list {
			t.Errorf("title %q list %q", q.Title, q.ListID)
		}
		a, ev := q.Leads[0], q.Leads[1]
		if a.Name != "Ada" || a.FirstName != "Ada" || a.HerTimeZone != "America/New_York" || a.ScriptID != script || a.LastCall != nil || a.ListName != "October" {
			t.Errorf("Ada = %+v", a)
		}
		if ev.Attempts != 1 || ev.LastCall == nil || ev.LastCall.Outcome != "callback" || ev.LastCall.Note != "After 3 pm" {
			t.Errorf("Eve = %+v, last call %+v", ev, ev.LastCall)
		}
		if len(q.Scripts) != 1 || q.Scripts[0].Name != "Office cleaning" || len(q.Scripts[0].Parts) != 1 || q.Scripts[0].Parts[0].Body != "Hi {first_name}" {
			t.Errorf("scripts = %+v", q.Scripts)
		}
		// Free shows the script for 2 months from sign-up (3 days ago).
		wantFree := time.Date(2026, 12, 2, 0, 0, 0, 0, time.UTC)
		if q.ScriptFreeUntil == nil || !q.ScriptFreeUntil.Equal(wantFree) {
			t.Errorf("script free until %v, want %v", q.ScriptFreeUntil, wantFree)
		}
		if q.DialLimit == nil || *q.DialLimit != 30 || q.DialsToday != 0 {
			t.Errorf("dials %d of %v", q.DialsToday, q.DialLimit)
		}
		if q.PricePerMin != freeRate || q.Balance != 10*dollar || q.LiveCallID != "" {
			t.Errorf("price %d balance %d live %q", q.PricePerMin, q.Balance, q.LiveCallID)
		}
	})

	t.Run("no list given: the one Today offers", func(t *testing.T) {
		q, err := e.svc.Queue(ctx, u.ID, QueueFor{})
		if err != nil || q.ListID != list || len(q.Leads) != 2 {
			t.Fatalf("queue = %+v, %v", q, err)
		}
	})

	t.Run("follow-ups due today, in due order", func(t *testing.T) {
		q, err := e.svc.Queue(ctx, u.ID, QueueFor{Followups: true})
		if err != nil {
			t.Fatal(err)
		}
		if !same(ids(q), []string{eve}) || q.Title != "Follow-ups due today" || q.ListID != "" {
			t.Fatalf("follow-ups = %v %q", ids(q), q.Title)
		}
	})

	t.Run("one lead, even one the list leaves out", func(t *testing.T) {
		q, err := e.svc.Queue(ctx, u.ID, QueueFor{LeadID: tried})
		if err != nil || !same(ids(q), []string{tried}) || q.Title != "October" {
			t.Fatalf("lead queue = %v %q, %v", ids(q), q.Title, err)
		}
	})

	t.Run("another rep's list or lead", func(t *testing.T) {
		other, otherList := e.rep(0)
		otherLead := e.lead(other.ID, otherList, "+12125550706", "Zed")
		if _, err := e.svc.Queue(ctx, u.ID, QueueFor{ListID: otherList}); !errors.Is(err, ErrListNotFound) {
			t.Errorf("other list: %v", err)
		}
		if _, err := e.svc.Queue(ctx, u.ID, QueueFor{ListID: "nope"}); !errors.Is(err, ErrListNotFound) {
			t.Errorf("bad list id: %v", err)
		}
		if _, err := e.svc.Queue(ctx, u.ID, QueueFor{LeadID: otherLead}); !errors.Is(err, ErrLeadNotFound) {
			t.Errorf("other lead: %v", err)
		}
		q, err := e.svc.Queue(ctx, other.ID, QueueFor{ListID: otherList})
		if err != nil || q.Balance != 0 || len(q.Scripts) != 0 {
			t.Errorf("other rep's own queue = %+v, %v", q, err)
		}
	})

	t.Run("an open call shows, and hanging up bills it at once", func(t *testing.T) {
		st, err := e.svc.Start(ctx, u, ada)
		if err != nil {
			t.Fatal(err)
		}
		q, err := e.svc.Queue(ctx, u.ID, QueueFor{ListID: list})
		if err != nil || q.LiveCallID != st.CallID || q.DialsToday != 1 {
			t.Fatalf("live call %q dials %d, %v", q.LiveCallID, q.DialsToday, err)
		}
		e.event(st, telephony.EventInitiated, morning, "")
		e.event(st, telephony.EventAnswered, morning.Add(5*time.Second), "")
		e.clock = morning.Add(50 * time.Second)
		c, err := e.svc.Hangup(ctx, u.ID, st.CallID)
		e.clock = morning
		if err != nil {
			t.Fatal(err)
		}
		want := rates.Charge(freeRate, 45)
		if c.Status != "ended" || c.Seconds != 45 || c.Cost != want || c.HangupCause != "rep_hung_up" {
			t.Fatalf("call = %+v, want 45 s for %d", c, want)
		}
		if e.fake.Hung[len(e.fake.Hung)-1] != "cc-"+st.CallID {
			t.Errorf("provider not told to hang up: %v", e.fake.Hung)
		}
		if b := e.balance(u.ID); b != 10*dollar-want {
			t.Errorf("balance %d, want %d", b, 10*dollar-want)
		}
		// The provider's own hangup event after that changes nothing.
		e.event(st, telephony.EventHangup, morning.Add(80*time.Second), "")
		if c := e.call(st.CallID); c.Seconds != 45 || c.Cost != want {
			t.Errorf("after the provider's event: %+v", c)
		}
	})

	t.Run("http", func(t *testing.T) {
		r := chi.NewRouter()
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				next.ServeHTTP(w, req.WithContext(auth.WithUser(req.Context(), u)))
			})
		})
		e.svc.Routes(r)
		srv := httptest.NewServer(r)
		defer srv.Close()
		get := func(path string) (int, map[string]any) {
			resp, err := http.Get(srv.URL + path)
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			out := map[string]any{}
			_ = json.NewDecoder(resp.Body).Decode(&out)
			return resp.StatusCode, out
		}
		status, body := get("/queue?list=" + list)
		leads, _ := body["leads"].([]any)
		if status != 200 || len(leads) != 2 || body["title"] != "October" || body["script_free_until"] != "2026-12-02" || body["live_call_id"] != nil {
			t.Fatalf("GET /queue = %d %v", status, body)
		}
		first, _ := leads[0].(map[string]any)
		if first["last_call"] == nil || first["her_time_zone"] != "America/New_York" || first["script_id"] != script {
			t.Errorf("first lead = %v", first)
		}
		if status, body := get("/queue?followups=1"); status != 200 || body["list_id"] != nil {
			t.Errorf("follow-ups = %d %v", status, body)
		}
		if status, body := get("/queue?list=nope"); status != 404 || body["code"] != "list_not_found" {
			t.Errorf("bad list = %d %v", status, body)
		}
	})
}
