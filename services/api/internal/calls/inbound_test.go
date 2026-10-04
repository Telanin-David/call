package calls

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/telanin-david/call/services/api/internal/rates"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

func TestIncomingCalls(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, list := e.rep(10 * dollar)
	db := e.svc.DB
	leadPhone := randomNumber("917")
	lead := e.lead(u.ID, list, leadPhone, "Mark")

	ring := func(from string) Call {
		t.Helper()
		c, err := e.svc.DevIncoming(ctx, e.fake, u.ID, from)
		if err != nil {
			t.Fatalf("incoming from %s: %v", from, err)
		}
		return c
	}
	online := func() *IncomingCall {
		t.Helper()
		in, err := e.svc.Ringing(ctx, u.ID)
		if err != nil {
			t.Fatal(err)
		}
		return in
	}
	missedFollowups := func() (open, missed int) {
		t.Helper()
		_ = db.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE kind = 'missed_call') FROM followups WHERE lead_id = $1 AND NOT done`, lead).Scan(&open, &missed)
		return open, missed
	}
	ccOf := func(c Call) string { return c.ProviderID }
	inHistory := func(id string) *HistoryItem {
		t.Helper()
		items, _, err := e.svc.History(ctx, u.ID, "", "", nil, 50)
		if err != nil {
			t.Fatal(err)
		}
		for i := range items {
			if items[i].ID == id {
				return &items[i]
			}
		}
		return nil
	}

	t.Run("on Free a call back is a missed call, at the top of Follow-ups", func(t *testing.T) {
		online()
		c := ring(leadPhone)
		if c.Status != "ended" || c.HangupCause != missedFree || c.Direction != "inbound" || c.LeadID != lead || c.Cost != 0 {
			t.Fatalf("free: %+v", c)
		}
		if !slices.Contains(e.fake.Hung, ccOf(c)) {
			t.Error("the caller wasn't hung up")
		}
		if open, missed := missedFollowups(); open != 1 || missed != 1 {
			t.Errorf("follow-ups = %d open, %d missed", open, missed)
		}
		list, _, err := e.svc.Followups(ctx, u.ID, "today")
		if err != nil || len(list) != 1 || !list[0].Missed || list[0].Reason != "Missed call" {
			t.Errorf("follow-ups today = %+v, %v", list, err)
		}
	})
	if _, err := db.Exec(ctx, `INSERT INTO subscriptions (user_id, plan_id, next_renewal) VALUES ($1, 'starter', '2026-11-05')`, u.ID); err != nil {
		t.Fatal(err)
	}

	t.Run("app closed: missed, and the same follow-up moves up", func(t *testing.T) {
		e.clock = morning.Add(time.Minute)
		c := ring(leadPhone)
		e.clock = morning
		if c.HangupCause != missedOffline {
			t.Fatalf("offline: %+v", c)
		}
		if open, _ := missedFollowups(); open != 1 {
			t.Errorf("open follow-ups = %d, want 1", open)
		}
	})

	quote, err := rates.For(ctx, db, "starter", leadPhone)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("app open: it rings the rep, who answers and pays to the second", func(t *testing.T) {
		before := e.balance(u.ID)
		online()
		c := ring(leadPhone)
		if c.Status != "ringing" || c.PricePerMin != quote.PricePerMin || c.HoldID == "" || c.ClientState == "" {
			t.Fatalf("ringing: %+v", c)
		}
		cred := ""
		_ = db.QueryRow(ctx, `SELECT telnyx_credential_id FROM users WHERE id = $1`, u.ID).Scan(&cred)
		if !slices.Contains(e.fake.Rung, ccOf(c)+">"+cred) || cred == "" {
			t.Errorf("rung %v, credential %q", e.fake.Rung, cred)
		}
		in := online()
		if in == nil || in.Call.ID != c.ID || in.Lead.ID != lead || in.Lead.Name != "Mark" || !in.RingUntil.Equal(c.StartedAt.Add(InboundRingFor)) {
			t.Fatalf("app sees %+v", in)
		}
		if in.Lead.LastCall == nil || in.Lead.LastCall.At.Equal(c.StartedAt) {
			t.Errorf("last call should be the one before this: %+v", in.Lead.LastCall)
		}
		other := e.lead(u.ID, list, randomNumber("212"), "Ann")
		if _, err := e.svc.Start(ctx, u, other); !errors.Is(err, ErrBeingCalled) {
			t.Errorf("dialling while a call rings in: %v", err)
		}
		if q, err := e.svc.Queue(ctx, u.ID, QueueFor{ListID: list}); err != nil || q.LiveCallID != "" {
			t.Errorf("a call ringing in is not a call to end from the queue: %q, %v", q.LiveCallID, err)
		}

		// The rep answers in the browser; the provider's events follow.
		st := Started{CallID: c.ID, ClientState: c.ClientState, From: c.FromNumber, To: "sip:rep@sip.telnyx.com"}
		e.event(st, telephony.EventInitiated, morning, "sip:rep@sip.telnyx.com")
		if got := e.call(c.ID); got.Status != "ringing" || got.ProviderID != c.ProviderID {
			t.Fatalf("the leg to the browser must not end or replace the call: %+v", got)
		}
		e.event(st, telephony.EventAnswered, morning.Add(2*time.Second), "")
		if online() != nil {
			t.Error("an answered call still shows as ringing")
		}
		e.event(st, telephony.EventHangup, morning.Add(62*time.Second), "")
		got := e.call(c.ID)
		if got.Status != "ended" || got.Seconds != 60 || got.Cost != rates.Charge(quote.PricePerMin, 60) {
			t.Fatalf("after a minute: %+v", got)
		}
		if after := e.balance(u.ID); before-after != got.Cost {
			t.Errorf("paid %d, want %d", before-after, got.Cost)
		}
		if _, err := e.svc.SaveOutcome(ctx, u.ID, c.ID, OutcomeInput{Outcome: Interested, Note: "Wants a quote"}); err != nil {
			t.Fatal(err)
		}
		if open, _ := missedFollowups(); open != 0 {
			t.Errorf("talking to them closes the missed call; %d open", open)
		}
		var tries int
		_ = db.QueryRow(ctx, `SELECT attempts FROM leads WHERE id = $1`, lead).Scan(&tries)
		if tries != 0 {
			t.Errorf("a call in counted as one of the 3 tries: %d", tries)
		}
		if h := inHistory(c.ID); h == nil || !h.Incoming || !h.Answered || h.Lead == nil {
			t.Errorf("history = %+v", h)
		}
		tot, err := e.svc.totals(ctx, u.ID, morning.Add(-time.Hour), morning.Add(time.Hour))
		if err != nil || tot.Calls != 0 || tot.Spent != got.Cost || tot.Interested != 1 {
			t.Errorf("totals = %+v, %v (a call in isn't a dial, but its cost counts)", tot, err)
		}
	})

	t.Run("not answered in 30 seconds: missed, nothing paid", func(t *testing.T) {
		before := e.balance(u.ID)
		online()
		c := ring(leadPhone)
		e.clock = morning.Add(InboundRingFor + 5*time.Second)
		res, err := e.svc.Tick(ctx)
		e.clock = morning
		if err != nil || res.Ended != 1 {
			t.Fatalf("tick = %+v, %v", res, err)
		}
		if got := e.call(c.ID); got.HangupCause != "ring_timeout" || got.Cost != 0 {
			t.Errorf("timed out: %+v", got)
		}
		if e.balance(u.ID) != before {
			t.Error("the hold wasn't given back")
		}
		if _, missed := missedFollowups(); missed != 1 {
			t.Errorf("missed follow-ups = %d", missed)
		}
	})

	t.Run("Not now: declined, added to follow-ups", func(t *testing.T) {
		online()
		c := ring(leadPhone)
		if c.Status != "ringing" {
			t.Fatalf("not ringing: %+v", c)
		}
		got, err := e.svc.Hangup(ctx, u.ID, c.ID)
		if err != nil || got.HangupCause != "declined" || !slices.Contains(e.fake.Hung, ccOf(c)) {
			t.Fatalf("decline = %+v, %v", got, err)
		}
		if open, missed := missedFollowups(); open != 1 || missed != 1 {
			t.Errorf("follow-ups = %d open, %d missed", open, missed)
		}
	})

	t.Run("on another call: missed", func(t *testing.T) {
		online()
		st, err := e.svc.Start(ctx, u, e.lead(u.ID, list, randomNumber("212"), "Bo"))
		if err != nil {
			t.Fatal(err)
		}
		if c := ring(leadPhone); c.HangupCause != missedBusy {
			t.Errorf("busy: %+v", c)
		}
		if _, err := e.svc.Hangup(ctx, u.ID, st.CallID); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("not enough money for a minute: missed", func(t *testing.T) {
		poor, poorList := e.rep(0)
		phone := randomNumber("917")
		e.lead(poor.ID, poorList, phone, "Cy")
		if _, err := db.Exec(ctx, `INSERT INTO subscriptions (user_id, plan_id, next_renewal) VALUES ($1, 'starter', '2026-11-05')`, poor.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := e.svc.Ringing(ctx, poor.ID); err != nil {
			t.Fatal(err)
		}
		c, err := e.svc.DevIncoming(ctx, e.fake, poor.ID, phone)
		if err != nil || c.HangupCause != missedLowFunds || c.HoldID != "" {
			t.Fatalf("no money: %+v, %v", c, err)
		}
	})

	t.Run("a caller who isn't a lead: in History only", func(t *testing.T) {
		online()
		stranger := randomNumber("305")
		c := ring(stranger)
		if c.HangupCause != missedUnknown || c.LeadID != "" {
			t.Fatalf("unknown caller: %+v", c)
		}
		if h := inHistory(c.ID); h == nil || h.Lead != nil || h.To != stranger || h.Answered || !h.Incoming {
			t.Errorf("history = %+v", h)
		}
	})

	t.Run("a number that isn't a rep's is hung up; a repeated event does nothing", func(t *testing.T) {
		body, h := e.fake.Event(telephony.CallEvent{Type: telephony.EventInitiated, CallControlID: "cc-nobody", From: leadPhone, To: randomNumber("415"), At: morning, Incoming: true})
		ev, err := e.fake.ParseEvent(h, body, morning)
		if err != nil {
			t.Fatal(err)
		}
		if err := e.svc.HandleEvent(ctx, ev); err != nil || !slices.Contains(e.fake.Hung, "cc-nobody") {
			t.Errorf("not ours: %v, hung %v", err, e.fake.Hung)
		}
		var to string
		_ = db.QueryRow(ctx, `SELECT number FROM numbers WHERE user_id = $1`, u.ID).Scan(&to)
		ev = telephony.CallEvent{Type: telephony.EventInitiated, CallControlID: "cc-twice-" + strings.ReplaceAll(u.ID, "-", ""), From: leadPhone, To: to, At: morning, Incoming: true}
		for range 2 {
			body, h := e.fake.Event(ev)
			parsed, _ := e.fake.ParseEvent(h, body, morning)
			if err := e.svc.HandleEvent(ctx, parsed); err != nil {
				t.Fatal(err)
			}
		}
		var n int
		_ = db.QueryRow(ctx, `SELECT count(*) FROM calls WHERE telnyx_call_id = $1`, ev.CallControlID).Scan(&n)
		if n != 1 {
			t.Errorf("calls for one event sent twice = %d", n)
		}
	})

	t.Run("ringing too long is ended when the app checks, too", func(t *testing.T) {
		var id string
		_ = db.QueryRow(ctx, `SELECT id FROM calls WHERE user_id = $1 AND status = 'ringing'`, u.ID).Scan(&id)
		if id == "" {
			online()
			id = ring(leadPhone).ID
		}
		e.clock = morning.Add(InboundRingFor + time.Second)
		in, err := e.svc.Ringing(ctx, u.ID)
		e.clock = morning
		if err != nil || in != nil || e.call(id).HangupCause != "ring_timeout" {
			t.Errorf("after 31 s: %+v, %v, %+v", in, err, e.call(id))
		}
	})
}
