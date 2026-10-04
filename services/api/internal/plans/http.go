package plans

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Routes mounts the plan endpoints (Sessions.Load must run first).
func (s *Service) Routes(r chi.Router) {
	r.Get("/plans", s.handleList)
	r.With(auth.RequireUser).Get("/subscription", s.handleSubscription)
	r.With(auth.RequireUser).Post("/subscription/quote", s.handleQuote)
	r.With(auth.RequireConfirmed).Post("/subscription", s.handleChange)
}

type planJSON struct {
	ID            string   `json:"id"`
	MonthlyFee    int64    `json:"monthly_fee_microdollars"`
	IntroFee      int64    `json:"intro_fee_microdollars"`
	IntroMonths   int      `json:"intro_months"`
	MultiplierPct int      `json:"rate_multiplier_pct"`
	USPricePerMin int64    `json:"us_price_per_minute_microdollars"`
	DialsPerDay   *int     `json:"dials_per_day"`
	Features      []string `json:"features"`
}

type quoteJSON struct {
	From         string  `json:"from"`
	To           string  `json:"to"`
	Kind         Kind    `json:"kind"`
	DueToday     int64   `json:"due_today_microdollars"`
	Intro        bool    `json:"intro_price"`
	StartsOn     string  `json:"starts_on"`
	NextRenewal  *string `json:"next_renewal"`
	NextCharge   int64   `json:"next_charge_microdollars"`
	Balance      int64   `json:"balance_microdollars"`
	BalanceAfter int64   `json:"balance_after_microdollars"`
}

func dateJSON(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

func toQuoteJSON(q Quote) quoteJSON {
	return quoteJSON{From: q.From, To: q.To, Kind: q.Kind, DueToday: q.DueToday, Intro: q.Intro,
		StartsOn: q.StartsOn.Format("2006-01-02"), NextRenewal: dateJSON(q.NextRenewal), NextCharge: q.NextCharge,
		Balance: q.Balance, BalanceAfter: q.BalanceAfter}
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	all, err := List(r.Context(), s.DB)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]planJSON, 0, len(all))
	for _, p := range all {
		feats := p.Features
		if feats == nil {
			feats = []string{}
		}
		out = append(out, planJSON{p.ID, p.MonthlyFee, p.IntroFee, p.IntroMonths, p.MultiplierPct, p.USPricePerMin, p.DialsPerDay, feats})
	}
	body := map[string]any{"plans": out}
	if u, ok := auth.UserFrom(r.Context()); ok {
		var used bool
		if err := s.DB.QueryRow(r.Context(), `SELECT intro_used FROM users WHERE id = $1`, u.ID).Scan(&used); err != nil {
			s.fail(w, r, err)
			return
		}
		body["intro_eligible"] = !used
	}
	platform.JSON(w, http.StatusOK, body)
}

func (s *Service) handleSubscription(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	sub, paid, err := Current(r.Context(), s.DB, u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if !paid {
		platform.JSON(w, http.StatusOK, map[string]any{"plan": Free})
		return
	}
	next := sub.PlanID
	if sub.PendingChange != "" {
		next = sub.PendingChange
	}
	var charge int64
	if next != Free {
		p, err := Get(r.Context(), s.DB, next)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		charge = feeAt(p, sub.IntroEndsAt, sub.NextRenewal)
	}
	var graceEnds *time.Time
	if sub.RenewalFailedAt != nil {
		t := sub.RenewalFailedAt.Add(GraceDays * 24 * time.Hour)
		graceEnds = &t
	}
	var pending *string
	if sub.PendingChange != "" {
		pending = &sub.PendingChange
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"plan":                     sub.PlanID,
		"started_at":               sub.StartedAt,
		"intro_ends_on":            datePtr(sub.IntroEndsAt),
		"next_renewal":             sub.NextRenewal.Format("2006-01-02"),
		"pending_change":           pending,
		"next_charge_microdollars": charge,
		"renewal_failed_at":        sub.RenewalFailedAt,
		"grace_ends_at":            graceEnds,
	})
}

func datePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	return dateJSON(*t)
}

func (s *Service) handleQuote(w http.ResponseWriter, r *http.Request) {
	to, ok := readPlan(w, r)
	if !ok {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	q, err := s.Quote(r.Context(), u, to, time.Now())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toQuoteJSON(q))
}

func (s *Service) handleChange(w http.ResponseWriter, r *http.Request) {
	to, ok := readPlan(w, r)
	if !ok {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	q, err := s.Change(r.Context(), u, to, time.Now())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toQuoteJSON(q))
}

func readPlan(w http.ResponseWriter, r *http.Request) (string, bool) {
	var in struct {
		PlanID string `json:"plan_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return "", false
	}
	return in.PlanID, true
}

func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if errors.As(err, &e) {
		platform.ErrorJSON(w, e.Status, e.Code, e.Message)
		return
	}
	s.log().ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "err", err)
	platform.ErrorJSON(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
}
