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
	"github.com/telanin-david/call/services/api/internal/telephony"
)

// Routes mounts calls for signed-in reps (Sessions.Load must run first).
func (s *Service) Routes(r chi.Router) {
	r.With(auth.RequireUser).Get("/calls/{callID}", s.handleGet)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireConfirmed)
		r.Post("/calls", s.handleStart)
		r.Post("/calls/{callID}/hangup", s.handleHangup)
		r.Post("/calls/{callID}/outcome", s.handleOutcome)
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
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	st, err := s.Start(r.Context(), u, in.LeadID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusCreated, startedJSON{
		CallID: st.CallID, LeadID: st.Lead.ID, LeadName: st.Lead.Name(), From: st.From, To: st.To,
		PricePerMin: st.PricePerMin, Held: st.Held, Token: st.Token, ClientState: st.ClientState, HerTimeZone: st.HerTimeZone,
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

func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var b *Blocked
	if errors.As(err, &b) {
		platform.JSON(w, b.Status, map[string]string{"code": b.Code, "error": b.Message, "title": b.Title, "action": b.Action})
		return
	}
	s.log().ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "err", err)
	platform.ErrorJSON(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
}
