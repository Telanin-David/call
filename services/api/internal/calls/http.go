package calls

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/scripts"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

// Routes mounts calls for signed-in reps (Sessions.Load must run first).
func (s *Service) Routes(r chi.Router) {
	r.With(auth.RequireUser).Get("/calls/{callID}", s.handleGet)
	r.With(auth.RequireUser).Get("/today", s.handleToday)
	r.With(auth.RequireUser).Get("/followups", s.handleFollowups)
	r.With(auth.RequireUser).Get("/history", s.handleHistory)
	r.With(auth.RequireUser).Get("/queue", s.handleQueue)
	r.With(auth.RequireUser).Get("/pairing", s.handlePairingGet)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireConfirmed)
		r.Post("/calls", s.handleStart)
		r.Post("/calls/{callID}/hangup", s.handleHangup)
		r.Post("/calls/{callID}/outcome", s.handleOutcome)
		r.Post("/followups/{followupID}/done", s.handleFollowupDone)
		r.Post("/pairing", s.handlePairingCreate)
		r.Post("/pairing/join", s.handlePairingJoin)
		r.Post("/pairing/mute", s.handlePairingMute)
		r.Delete("/pairing", s.handlePairingEnd)
	})
}

// WebhookRoutes mounts the provider's call events. They carry no cookie;
// the signature is checked before anything else.
func (s *Service) WebhookRoutes(r chi.Router) {
	r.Post("/webhooks/telnyx", s.handleWebhook)
}

// DevRoutes lets development play the provider's events for a call:
// POST /dev/calls/{id}/events/{initiated|answered|hangup}. They go through
// the same signature check as real ones. Only mounted in development, and
// only does anything with the fake provider.
func (s *Service) DevRoutes(r chi.Router) {
	r.With(auth.RequireUser).Post("/dev/calls/{callID}/events/{event}", s.handleDevEvent)
}

type startedJSON struct {
	CallID      string `json:"call_id"`
	LeadID      string `json:"lead_id"`
	LeadName    string `json:"lead_name"`
	From        string `json:"from"`
	To          string `json:"to"`
	PricePerMin int64  `json:"price_per_minute_microdollars"`
	Held        int64  `json:"held_microdollars"`
	Token       string `json:"token"`
	ClientState string `json:"client_state"`
	HerTimeZone string `json:"her_time_zone"`
	// Phone says which browser phone dials: "telnyx", or "fake" in
	// development, where /dev/calls plays the provider's part.
	Phone string `json:"phone"`
}

type callJSON struct {
	ID          string     `json:"id"`
	LeadID      *string    `json:"lead_id"`
	From        string     `json:"from"`
	To          string     `json:"to"`
	Status      string     `json:"status"`
	PricePerMin int64      `json:"price_per_minute_microdollars"`
	StartedAt   time.Time  `json:"started_at"`
	AnsweredAt  *time.Time `json:"answered_at"`
	EndedAt     *time.Time `json:"ended_at"`
	Seconds     int64      `json:"seconds"`
	Cost        int64      `json:"cost_microdollars"`
	LowBalance  bool       `json:"low_balance"`
	Outcome     *string    `json:"outcome"`
	Note        string     `json:"note"`
}

func toJSON(c Call) callJSON {
	return callJSON{
		ID: c.ID, LeadID: nullable(c.LeadID), From: c.FromNumber, To: c.To, Status: c.Status, PricePerMin: c.PricePerMin,
		StartedAt: c.StartedAt, AnsweredAt: c.AnsweredAt, EndedAt: c.EndedAt, Seconds: c.Seconds, Cost: c.Cost,
		LowBalance: c.LowBalanceAt != nil && c.Status != "ended", Outcome: nullable(c.Outcome), Note: c.Note,
	}
}

func (s *Service) handleStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		LeadID string `json:"lead_id"`
		// Via is "phone" to call through the rep's linked phone.
		Via string `json:"via"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	st, err := s.StartVia(r.Context(), u, in.LeadID, in.Via == "phone")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusCreated, startedJSON{
		CallID: st.CallID, LeadID: st.Lead.ID, LeadName: st.Lead.Name(), From: st.From, To: st.To,
		PricePerMin: st.PricePerMin, Held: st.Held, Token: st.Token, ClientState: st.ClientState, HerTimeZone: st.HerTimeZone,
		Phone: s.phoneKind(st.ViaPhone),
	})
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	c, err := s.Get(r.Context(), u.ID, chi.URLParam(r, "callID"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toJSON(c))
}

func (s *Service) handleHangup(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	c, err := s.Hangup(r.Context(), u.ID, chi.URLParam(r, "callID"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toJSON(c))
}

func (s *Service) handleOutcome(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Outcome    Outcome    `json:"outcome"`
		Note       string     `json:"note"`
		FollowUpAt *time.Time `json:"follow_up_at"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	c, err := s.SaveOutcome(r.Context(), u.ID, chi.URLParam(r, "callID"), OutcomeInput(in))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toJSON(c))
}

func (s *Service) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if s.Provider == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 256<<10))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ev, err := s.Provider.ParseEvent(r.Header, body, s.now())
	if errors.Is(err, telephony.ErrBadSignature) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err := s.HandleEvent(r.Context(), ev); err != nil {
		// Telnyx retries on errors, and every step is safe to repeat.
		s.log().ErrorContext(r.Context(), "call event failed", "type", ev.Type, "call_control_id", ev.CallControlID, "err", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Service) handleDevEvent(w http.ResponseWriter, r *http.Request) {
	fake, ok := s.Provider.(*telephony.FakeCalls)
	if !ok {
		platform.ErrorJSON(w, http.StatusNotFound, "not_found", "Only with the fake phone provider.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	c, err := s.Get(r.Context(), u.ID, chi.URLParam(r, "callID"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	ev := telephony.CallEvent{CallControlID: c.ProviderID, ClientState: c.ClientState, From: c.FromNumber, To: c.To, At: s.now()}
	switch chi.URLParam(r, "event") {
	case "initiated":
		ev.Type, ev.CallControlID = telephony.EventInitiated, "fake-cc-"+c.ID
	case "answered":
		ev.Type = telephony.EventAnswered
	case "hangup":
		ev.Type, ev.HangupCause = telephony.EventHangup, "normal_clearing"
	default:
		platform.ErrorJSON(w, http.StatusNotFound, "not_found", "Use initiated, answered or hangup.")
		return
	}
	body, h := fake.Event(ev)
	parsed, err := fake.ParseEvent(h, body, s.now())
	if err == nil {
		err = s.HandleEvent(r.Context(), parsed)
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	c, err = s.Get(r.Context(), u.ID, c.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toJSON(c))
}

type leadRefJSON struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Company     string `json:"company"`
	Phone       string `json:"phone"`
	HerTimeZone string `json:"her_time_zone"`
}

func leadJSON(l LeadRef) leadRefJSON {
	return leadRefJSON{l.ID, l.Name, l.Company, l.Phone, l.HerTimeZone}
}

type totalsJSON struct {
	Calls       int   `json:"calls"`
	TalkSeconds int64 `json:"talk_seconds"`
	Spent       int64 `json:"spent_microdollars"`
	Interested  int   `json:"interested"`
}

func totalsOf(t Totals) totalsJSON { return totalsJSON{t.Calls, t.TalkSeconds, t.Spent, t.Interested} }

type followupJSON struct {
	ID          string      `json:"id"`
	Lead        leadRefJSON `json:"lead"`
	DueAt       time.Time   `json:"due_at"`
	Reason      string      `json:"reason"`
	LastNote    string      `json:"last_note"`
	LastOutcome *string     `json:"last_outcome"`
}

func followupsJSON(fs []Followup) []followupJSON {
	out := make([]followupJSON, len(fs))
	for i, f := range fs {
		out[i] = followupJSON{f.ID, leadJSON(f.Lead), f.DueAt, f.Reason, f.LastNote, nullable(f.LastOutcome)}
	}
	return out
}

func (s *Service) handleToday(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	t, err := s.Today(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	var ready any
	if t.Ready != nil {
		ready = map[string]any{"id": t.Ready.ID, "name": t.Ready.Name, "left": t.Ready.Left, "script_name": t.Ready.ScriptName}
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"dials_today": t.DialsToday, "dial_limit": t.DialLimit, "today": totalsOf(t.Today), "yesterday": totalsOf(t.Yesterday),
		"followups_due": t.DueCount, "due": followupsJSON(t.DueToday), "ready_list": ready,
	})
}

func (s *Service) handleFollowups(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	tab := r.URL.Query().Get("tab")
	switch tab {
	case "", "today", "tomorrow", "week", "later":
	default:
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_tab", "Pick today, tomorrow, week or later.")
		return
	}
	list, c, err := s.Followups(r.Context(), u.ID, tab)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"counts":    map[string]int{"today": c.Today, "tomorrow": c.Tomorrow, "week": c.Week, "later": c.Later},
		"followups": followupsJSON(list),
	})
}

func (s *Service) handleFollowupDone(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	if err := s.FollowupDone(r.Context(), u.ID, chi.URLParam(r, "followupID")); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleHistory(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	q := r.URL.Query()
	after, err := ParseHistoryCursor(q.Get("cursor"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	items, next, err := s.History(r.Context(), u.ID, q.Get("outcome"), q.Get("q"), after, 50)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	week, err := s.Week(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	type itemJSON struct {
		ID        string       `json:"id"`
		Lead      *leadRefJSON `json:"lead"`
		To        string       `json:"to"`
		StartedAt time.Time    `json:"started_at"`
		Seconds   int64        `json:"seconds"`
		Cost      int64        `json:"cost_microdollars"`
		Outcome   *string      `json:"outcome"`
		Note      string       `json:"note"`
	}
	out := make([]itemJSON, len(items))
	for i, h := range items {
		out[i] = itemJSON{ID: h.ID, To: h.To, StartedAt: h.StartedAt, Seconds: h.Seconds, Cost: h.Cost, Outcome: nullable(h.Outcome), Note: h.Note}
		if h.Lead != nil {
			l := leadJSON(*h.Lead)
			out[i].Lead = &l
		}
	}
	cursor := ""
	if next != nil {
		cursor = next.String()
	}
	platform.JSON(w, http.StatusOK, map[string]any{"calls": out, "next_cursor": cursor, "week": totalsOf(week)})
}

func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var b *Blocked
	if errors.As(err, &b) {
		platform.JSON(w, b.Status, map[string]string{"code": b.Code, "error": b.Message, "title": b.Title, "action": b.Action})
		return
	}
	s.log().ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "err", err)
	platform.ErrorJSON(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
}

// phoneKind says who dials: "paired" (the linked phone does), "fake" in
// development, else "telnyx".
func (s *Service) phoneKind(viaPhone bool) string {
	if viaPhone {
		return "paired"
	}
	if _, ok := s.Provider.(*telephony.FakeCalls); ok {
		return "fake"
	}
	return "telnyx"
}

type lastCallJSON struct {
	At      time.Time `json:"at"`
	Outcome *string   `json:"outcome"`
	Note    string    `json:"note"`
}

type queueLeadJSON struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	FirstName   string        `json:"first_name"`
	Company     string        `json:"company"`
	City        string        `json:"city"`
	Email       string        `json:"email"`
	Phone       string        `json:"phone"`
	Notes       string        `json:"notes"`
	HerTimeZone string        `json:"her_time_zone"`
	Attempts    int           `json:"attempts"`
	ListName    string        `json:"list_name"`
	ScriptID    *string       `json:"script_id"`
	LastCall    *lastCallJSON `json:"last_call"`
}

type queueScriptJSON struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Parts []scripts.Part `json:"parts"`
}

type queueJSON struct {
	Title           string            `json:"title"`
	ListID          *string           `json:"list_id"`
	Leads           []queueLeadJSON   `json:"leads"`
	Scripts         []queueScriptJSON `json:"scripts"`
	ScriptFreeUntil *string           `json:"script_free_until"`
	DialsToday      int               `json:"dials_today"`
	DialLimit       *int              `json:"dial_limit"`
	Balance         int64             `json:"balance_microdollars"`
	PricePerMin     int64             `json:"price_per_minute_microdollars"`
	LiveCallID      *string           `json:"live_call_id"`
}

func (s *Service) handleQueue(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	qs := r.URL.Query()
	q, err := s.Queue(r.Context(), u.ID, QueueFor{ListID: qs.Get("list"), Followups: qs.Get("followups") == "1", LeadID: qs.Get("lead")})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := queueJSON{
		Title: q.Title, ListID: nullable(q.ListID), Leads: make([]queueLeadJSON, 0, len(q.Leads)), Scripts: make([]queueScriptJSON, 0, len(q.Scripts)),
		DialsToday: q.DialsToday, DialLimit: q.DialLimit, Balance: q.Balance, PricePerMin: q.PricePerMin, LiveCallID: nullable(q.LiveCallID),
	}
	for _, l := range q.Leads {
		j := queueLeadJSON{
			ID: l.ID, Name: l.Name, FirstName: l.FirstName, Company: l.Company, City: l.City, Email: l.Email, Phone: l.Phone, Notes: l.Notes,
			HerTimeZone: l.HerTimeZone, Attempts: l.Attempts, ListName: l.ListName, ScriptID: nullable(l.ScriptID),
		}
		if l.LastCall != nil {
			j.LastCall = &lastCallJSON{At: l.LastCall.At, Outcome: nullable(l.LastCall.Outcome), Note: l.LastCall.Note}
		}
		out.Leads = append(out.Leads, j)
	}
	for _, sc := range q.Scripts {
		parts := sc.Parts
		if parts == nil {
			parts = []scripts.Part{}
		}
		out.Scripts = append(out.Scripts, queueScriptJSON{ID: sc.ID, Name: sc.Name, Parts: parts})
	}
	if q.ScriptFreeUntil != nil {
		d := q.ScriptFreeUntil.Format("2006-01-02")
		out.ScriptFreeUntil = &d
	}
	platform.JSON(w, http.StatusOK, out)
}

type pairedCallJSON struct {
	ID          string     `json:"id"`
	Status      string     `json:"status"`
	LeadName    string     `json:"lead_name"`
	From        string     `json:"from"`
	To          string     `json:"to"`
	ClientState string     `json:"client_state"`
	AnsweredAt  *time.Time `json:"answered_at"`
	PricePerMin int64      `json:"price_per_minute_microdollars"`
	NeedsDial   bool       `json:"needs_dial"`
}

type pairingJSON struct {
	ID        *string         `json:"id"`
	Status    PairingStatus   `json:"status"`
	PhoneName string          `json:"phone_name"`
	Muted     bool            `json:"muted"`
	ExpiresAt *time.Time      `json:"expires_at"`
	Call      *pairedCallJSON `json:"call"`
	// Phone is who dials on the phone: "fake" in development, else "telnyx".
	Phone string `json:"phone"`
	// Code is only in the reply that made it; Token only in the join reply.
	Code  string `json:"code,omitempty"`
	Token string `json:"token,omitempty"`
}

func (s *Service) pairingOut(p Pairing) pairingJSON {
	out := pairingJSON{ID: nullable(p.ID), Status: p.Status, PhoneName: p.PhoneName, Muted: p.Muted, Phone: s.phoneKind(false)}
	if p.Status == PairingWaiting {
		at := p.ExpiresAt
		out.ExpiresAt = &at
	}
	if p.Call != nil {
		c := p.Call
		out.Call = &pairedCallJSON{ID: c.ID, Status: c.Status, LeadName: c.LeadName, From: c.From, To: c.To, ClientState: c.ClientState,
			AnsweredAt: c.AnsweredAt, PricePerMin: c.PricePerMin, NeedsDial: c.NeedsDial}
	}
	return out
}

func (s *Service) handlePairingCreate(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	p, code, err := s.CreatePairing(r.Context(), u)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := s.pairingOut(p)
	out.Code = code
	platform.JSON(w, http.StatusCreated, out)
}

// handlePairingGet is polled by both devices; ?as=phone is the phone
// checking in.
func (s *Service) handlePairingGet(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	p, err := s.PairingState(r.Context(), u.ID, r.URL.Query().Get("as") == "phone")
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := s.pairingOut(p)
	if r.URL.Query().Get("as") != "phone" && out.Call != nil {
		// Only the phone dials, so only the phone gets the call's secret.
		out.Call.ClientState = ""
	}
	platform.JSON(w, http.StatusOK, out)
}

func (s *Service) handlePairingJoin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code      string `json:"code"`
		PhoneName string `json:"phone_name"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	p, err := s.JoinPairing(r.Context(), u, in.Code, in.PhoneName)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := s.pairingOut(p)
	if s.Provider != nil {
		token, err := s.login(r.Context(), u.ID)
		if err != nil {
			s.log().ErrorContext(r.Context(), "phone login failed", "user_id", u.ID, "err", err)
			s.fail(w, r, ErrUnavailable)
			return
		}
		out.Token = token
	}
	platform.JSON(w, http.StatusOK, out)
}

func (s *Service) handlePairingMute(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Muted bool `json:"muted"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	if err := s.SetPairingMuted(r.Context(), u.ID, in.Muted); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handlePairingEnd(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	if err := s.EndPairing(r.Context(), u.ID); err != nil && !errors.Is(err, ErrNotPaired) {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
