package numbers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Routes mounts numbers for signed-in reps (Sessions.Load must run first).
func (s *Service) Routes(r chi.Router) {
	r.With(auth.RequireUser).Get("/numbers", s.handleList)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireConfirmed)
		r.Get("/numbers/available", s.handleSearch)
		r.Post("/numbers", s.handleRent)
		r.Put("/numbers/{numberID}/default", s.handleDefault)
		r.Delete("/numbers/{numberID}", s.handleCancel)
		r.Post("/numbers/{numberID}/keep", s.handleKeep)
	})
}

type numberJSON struct {
	ID              string     `json:"id"`
	Number          string     `json:"number"`
	City            string     `json:"city"`
	Country         string     `json:"country"`
	Default         bool       `json:"is_default"`
	MonthlyPrice    int64      `json:"monthly_price_microdollars"`
	RenewsOn        string     `json:"renews_on"`
	CancelOn        *string    `json:"cancel_on"`
	RenewalFailedAt *time.Time `json:"renewal_failed_at"`
	CreatedAt       time.Time  `json:"created_at"`
}

func toJSON(n Number) numberJSON {
	j := numberJSON{n.ID, n.E164, n.City, n.Country, n.Default, n.MonthlyPrice, n.RenewsOn.Format("2006-01-02"), nil, n.RenewalFailedAt, n.CreatedAt}
	if n.CancelOn != nil {
		d := n.CancelOn.Format("2006-01-02")
		j.CancelOn = &d
	}
	return j
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	ns, err := s.List(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]numberJSON, len(ns))
	var total int64
	for i, n := range ns {
		out[i] = toJSON(n)
		if n.CancelOn == nil {
			total += n.MonthlyPrice
		}
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"numbers": out, "monthly_total_microdollars": total, "monthly_price_microdollars": Price(), "max_numbers": MaxNumbers,
	})
}

func (s *Service) handleSearch(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	found, err := s.Search(r.Context(), u.ID, r.URL.Query().Get("country"), r.URL.Query().Get("area_code"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	type availableJSON struct {
		Number string `json:"number"`
		City   string `json:"city"`
	}
	out := make([]availableJSON, len(found))
	for i, a := range found {
		out[i] = availableJSON{a.E164, a.City}
	}
	platform.JSON(w, http.StatusOK, map[string]any{"numbers": out, "monthly_price_microdollars": Price()})
}

func (s *Service) handleRent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Number  string `json:"number"`
		City    string `json:"city"`
		Country string `json:"country"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	n, err := s.Rent(r.Context(), u.ID, RentInput{E164: in.Number, City: in.City, Country: in.Country})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusCreated, toJSON(n))
}

func (s *Service) handleDefault(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, s.SetDefault)
}

func (s *Service) handleCancel(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, s.Cancel)
}

func (s *Service) handleKeep(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, s.Keep)
}

func (s *Service) one(w http.ResponseWriter, r *http.Request, do func(ctx context.Context, userID, id string) (Number, error)) {
	u, _ := auth.UserFrom(r.Context())
	n, err := do(r.Context(), u.ID, chi.URLParam(r, "numberID"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toJSON(n))
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
