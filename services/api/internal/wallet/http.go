package wallet

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/billing"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Routes mounts the wallet for signed-in reps (Sessions.Load must run first).
func (s *Service) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireUser)
		r.Get("/wallet", s.handleWallet)
		r.Get("/wallet/activity", s.handleActivity)
		r.Get("/wallet/statement", s.handleStatement)
		r.Get("/wallet/topups/{reference}", s.handleTopUpStatus)
	})
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireConfirmed)
		r.Post("/wallet/topups", s.handleStartTopUp)
	})
}

// WebhookRoutes mounts the provider webhooks. They carry no cookie and no
// JSON content-type rule: the provider's signature is the only check, and it
// runs before anything else.
func (s *Service) WebhookRoutes(r chi.Router) {
	r.Post("/webhooks/paystack", s.webhook("paystack"))
	r.Post("/webhooks/stripe", s.webhook("stripe"))
}

type entryJSON struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Amount      int64     `json:"amount_microdollars"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

func entriesJSON(es []ledger.Entry) []entryJSON {
	out := make([]entryJSON, 0, len(es))
	for _, e := range es {
		out = append(out, entryJSON{e.ID, string(e.Type), e.Amount, e.Description, e.CreatedAt})
	}
	return out
}

func (s *Service) handleWallet(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	sum, err := s.Summary(r.Context(), u, time.Now())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	spent := map[string]int64{"calls": sum.Spent[ledger.TypeCall], "plan": sum.Spent[ledger.TypePlan], "numbers": sum.Spent[ledger.TypeNumber]}
	spent["total"] = spent["calls"] + spent["plan"] + spent["numbers"]
	platform.JSON(w, http.StatusOK, map[string]any{
		"balance_microdollars":   sum.Balance,
		"held_microdollars":      sum.Held,
		"spent_this_month":       spent,
		"activity":               entriesJSON(sum.Activity),
		"next_cursor":            encodeCursor(sum.Next),
		"min_topup_microdollars": MinTopUp,
		"max_topup_microdollars": MaxTopUp,
		"topup_provider":         billing.ProviderFor(u.Country),
	})
}

func (s *Service) handleActivity(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	cur, err := decodeCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_cursor", "That page link is broken. Reload the wallet.")
		return
	}
	es, next, err := ledger.Activity(r.Context(), s.DB, u.ID, cur, 50)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"activity": entriesJSON(es), "next_cursor": encodeCursor(next)})
}

func (s *Service) handleStatement(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	from, to, err := ParseMonth(r.URL.Query().Get("month"), time.Now(), location(u.Timezone))
	if err != nil {
		platform.ErrorJSON(w, http.StatusUnprocessableEntity, "invalid_month", "Ask for a month like 2026-10.")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="dialer-statement-%s.csv"`, from.Format("2006-01")))
	if err := s.WriteStatement(r.Context(), w, u, from, to); err != nil {
		s.logError(r.Context(), "write statement", err)
	}
}

func (s *Service) handleStartTopUp(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Amount int64 `json:"amount_microdollars"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	t, err := s.StartTopUp(r.Context(), u, in.Amount)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusCreated, map[string]any{
		"reference": t.Reference, "payment_url": t.URL, "provider": t.Provider, "amount_microdollars": t.Amount,
	})
}

func (s *Service) handleTopUpStatus(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	t, err := s.TopUpStatus(r.Context(), u, chi.URLParam(r, "reference"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{
		"reference": t.Reference, "status": t.Status, "amount_microdollars": t.Amount, "created_at": t.CreatedAt,
	})
}

func (s *Service) webhook(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		err = s.HandleWebhook(r.Context(), provider, r.Header, body)
		switch {
		case errors.Is(err, billing.ErrBadSignature):
			w.WriteHeader(http.StatusUnauthorized)
		case err != nil:
			// The provider will retry; crediting is idempotent.
			s.logError(r.Context(), "webhook failed", err, "provider", provider)
			w.WriteHeader(http.StatusInternalServerError)
		default:
			w.WriteHeader(http.StatusOK)
		}
	}
}

func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if errors.As(err, &e) {
		platform.ErrorJSON(w, e.Status, e.Code, e.Message)
		return
	}
	s.logError(r.Context(), "request failed", err, "path", r.URL.Path)
	platform.ErrorJSON(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
}

// encodeCursor turns a page position into an opaque string ("" for none).
func encodeCursor(c *ledger.Cursor) string {
	if c == nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.FormatInt(c.At.UnixMicro(), 10) + ":" + c.ID))
}

func decodeCursor(s string) (*ledger.Cursor, error) {
	if s == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	at, id, ok := strings.Cut(string(b), ":")
	if !ok || len(id) != 36 {
		return nil, errors.New("bad cursor")
	}
	us, err := strconv.ParseInt(at, 10, 64)
	if err != nil {
		return nil, err
	}
	return &ledger.Cursor{At: time.UnixMicro(us), ID: id}, nil
}
