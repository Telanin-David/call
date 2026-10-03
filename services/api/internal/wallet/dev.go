package wallet

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/billing"
)

// DevRoutes adds POST /dev/topups/{reference}/pay, which plays the
// provider's "paid" webhook for a pending top-up. It only works with fake
// providers and is mounted only in development, so the full top-up can be
// tried before real Paystack or Stripe keys exist.
func (s *Service) DevRoutes(r chi.Router) {
	r.With(auth.RequireUser).Post("/dev/topups/{reference}/pay", func(w http.ResponseWriter, r *http.Request) {
		u, _ := auth.UserFrom(r.Context())
		ref := chi.URLParam(r, "reference")
		var provider, currency string
		var minor int64
		err := s.DB.QueryRow(r.Context(), `
			SELECT provider, currency, provider_amount_minor FROM payments WHERE user_id = $1 AND provider_ref = $2`,
			u.ID, ref).Scan(&provider, &currency, &minor)
		if err != nil {
			s.fail(w, r, ErrNotFound)
			return
		}
		fake, ok := s.Providers[provider].(*billing.Fake)
		if !ok {
			s.fail(w, r, errors.New("dev pay needs a fake provider"))
			return
		}
		body, h := fake.Sign(billing.Event{Kind: billing.Paid, Reference: ref, AmountMinor: minor, Currency: currency, CardLast4: "4242", CardName: u.Name})
		if err := s.HandleWebhook(r.Context(), provider, h, body); err != nil {
			s.fail(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
