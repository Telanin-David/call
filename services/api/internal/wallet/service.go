// Package wallet is the rep's money screen: balance, spending, activity,
// statements, and card top-ups. Top-ups start a checkout with a payment
// provider (package billing) and only reach the ledger when the provider's
// signed webhook says the money was taken.
package wallet

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/billing"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Top-up limits, in micro-dollars.
const (
	MinTopUp = 5_000_000   // $5
	MaxTopUp = 500_000_000 // $500 per payment
	// startsPerHour caps unfinished checkouts, against card testing.
	startsPerHour = 10
	microPerCent  = 10_000
)

// Charge says how a provider bills a US-dollar top-up: in which currency,
// and how many of that currency's smallest units make one dollar. Stripe
// charges USD (100 cents a dollar). Paystack charges USD if the merchant
// account allows it, otherwise local money at a rate we set.
type Charge struct {
	Currency    string
	MinorPerUSD int64
}

// Service holds what the wallet needs. Providers is keyed by name
// ("paystack", "stripe"); a missing provider means card top-ups aren't
// available to reps it would serve.
type Service struct {
	DB        *pgxpool.Pool
	Providers map[string]billing.Provider
	Charges   map[string]Charge
	// WebURL is where the provider sends the rep back to.
	WebURL string
	Log    *slog.Logger
}

// Error is a failure the rep can act on.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return "wallet: " + e.Code }

var (
	ErrAmount = &Error{http.StatusUnprocessableEntity, "invalid_amount",
		fmt.Sprintf("Top up between %s and %s, in whole cents.", FormatUSD(MinTopUp, 0), FormatUSD(MaxTopUp, 0))}
	ErrNoProvider = &Error{http.StatusServiceUnavailable, "cards_unavailable", "Card top-ups aren't available for your country yet."}
	ErrTooMany    = &Error{http.StatusTooManyRequests, "too_many", "Too many top-ups started. Wait a little and try again."}
	ErrNotFound   = &Error{http.StatusNotFound, "not_found", "No top-up with that reference."}
	ErrCheckout   = &Error{http.StatusBadGateway, "checkout_failed", "The card page didn't open. Try again in a minute."}
)

// TopUp is a checkout the rep is about to pay.
type TopUp struct {
	Reference string
	URL       string
	Provider  string
	Amount    int64 // micro-dollars the ledger will get
}

// StartTopUp records a pending payment and opens the provider's checkout.
// Nothing reaches the balance until the webhook confirms payment.
func (s *Service) StartTopUp(ctx context.Context, u auth.User, amount int64) (TopUp, error) {
	if amount < MinTopUp || amount > MaxTopUp || amount%microPerCent != 0 {
		return TopUp{}, ErrAmount
	}
	name := billing.ProviderFor(u.Country)
	p, ok := s.Providers[name]
	charge, okCharge := s.Charges[name]
	if !ok || !okCharge || charge.MinorPerUSD <= 0 {
		return TopUp{}, ErrNoProvider
	}
	var started int
	if err := s.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM payments WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour' AND status <> 'succeeded'`,
		u.ID).Scan(&started); err != nil {
		return TopUp{}, fmt.Errorf("count top-ups: %w", err)
	}
	if started >= startsPerHour {
		return TopUp{}, ErrTooMany
	}

	ref, err := newReference()
	if err != nil {
		return TopUp{}, err
	}
	minor := toMinor(amount, charge.MinorPerUSD)
	var paymentID string
	err = s.DB.QueryRow(ctx, `
		INSERT INTO payments (user_id, provider, provider_ref, provider_amount_minor, currency, status, credited_microdollars)
		VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING id`,
		u.ID, p.Name(), ref, minor, charge.Currency, amount).Scan(&paymentID)
	if err != nil {
		return TopUp{}, fmt.Errorf("record top-up: %w", err)
	}

	back := strings.TrimRight(s.WebURL, "/") + "/wallet?topup=" + ref
	url, err := p.StartCheckout(ctx, billing.Checkout{
		Reference: ref, Email: u.Email, AmountMinor: minor, Currency: charge.Currency,
		ReturnURL: back, CancelURL: back + "&cancelled=1",
	})
	if err != nil {
		s.logError(ctx, "start checkout", err, "reference", ref)
		if _, uerr := s.DB.Exec(ctx, `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`, paymentID); uerr != nil {
			s.logError(ctx, "mark checkout failed", uerr, "reference", ref)
		}
		return TopUp{}, ErrCheckout
	}
	return TopUp{Reference: ref, URL: url, Provider: p.Name(), Amount: amount}, nil
}

// toMinor converts micro-dollars to the provider's smallest unit, rounding
// up so we never collect less than we credit.
func toMinor(micro, minorPerUSD int64) int64 {
	return (micro*minorPerUSD + 999_999) / 1_000_000
}

func newReference() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("reference: %w", err)
	}
	return "top_" + hex.EncodeToString(b), nil
}

// HandleWebhook verifies and applies one provider webhook. It returns
// billing.ErrBadSignature for anything not signed by the provider.
func (s *Service) HandleWebhook(ctx context.Context, provider string, h http.Header, body []byte) error {
	p, ok := s.Providers[provider]
	if !ok {
		return billing.ErrBadSignature
	}
	ev, err := p.ParseWebhook(h, body)
	if err != nil {
		return err
	}
	switch ev.Kind {
	case billing.Paid:
		return s.confirm(ctx, p.Name(), ev)
	case billing.Failed:
		_, err := s.DB.Exec(ctx, `
			UPDATE payments SET status = 'failed', updated_at = NOW()
			WHERE provider = $1 AND provider_ref = $2 AND status = 'pending'`, p.Name(), ev.Reference)
		if err != nil {
			return fmt.Errorf("mark payment failed: %w", err)
		}
	}
	return nil
}

// confirm credits a paid top-up exactly once. A repeated webhook finds the
// payment already succeeded and does nothing; the ledger's idempotency key
// is a second guard.
func (s *Service) confirm(ctx context.Context, provider string, ev billing.Event) error {
	return platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var id, userID, status, currency, name string
		var minor, credit int64
		err := tx.QueryRow(ctx, `
			SELECT p.id, p.user_id, p.status, p.currency, p.provider_amount_minor, p.credited_microdollars, u.name
			FROM payments p JOIN users u ON u.id = p.user_id
			WHERE p.provider = $1 AND p.provider_ref = $2 FOR UPDATE OF p`, provider, ev.Reference).
			Scan(&id, &userID, &status, &currency, &minor, &credit, &name)
		if errors.Is(err, pgx.ErrNoRows) {
			// Not one of ours (for example a payment made outside Dialer on
			// the same provider account). Acknowledge so it isn't resent.
			s.logError(ctx, "webhook for unknown payment", errors.New("no such reference"), "provider", provider, "reference", ev.Reference)
			return nil
		}
		if err != nil {
			return fmt.Errorf("read payment: %w", err)
		}
		if status == "succeeded" {
			return nil
		}
		if ev.AmountMinor != minor || ev.Currency != currency {
			// Paid a different amount than we asked for: never credit it.
			s.logError(ctx, "payment amount mismatch", errors.New("amount or currency differs"),
				"reference", ev.Reference, "want", fmt.Sprintf("%d %s", minor, currency), "got", fmt.Sprintf("%d %s", ev.AmountMinor, ev.Currency))
			if _, err := tx.Exec(ctx, `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE id = $1`, id); err != nil {
				return fmt.Errorf("mark payment failed: %w", err)
			}
			return flag(ctx, tx, userID, fmt.Sprintf("Top-up %s paid %d %s, expected %d %s", ev.Reference, ev.AmountMinor, ev.Currency, minor, currency))
		}

		desc := "Top-up"
		if ev.CardLast4 != "" {
			desc = "Top-up, card ending " + ev.CardLast4
		}
		if _, err := ledger.Credit(ctx, tx, ledger.Posting{
			UserID: userID, Type: ledger.TypeTopUp, Amount: credit, Description: desc,
			Key: "payment:" + provider + ":" + ev.Reference, RefID: id,
		}); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE payments SET status = 'succeeded', card_last4 = NULLIF($2, ''), card_name = NULLIF($3, ''), updated_at = NOW()
			WHERE id = $1`, id, ev.CardLast4, ev.CardName); err != nil {
			return fmt.Errorf("mark payment paid: %w", err)
		}
		// The card name must match the account name. Providers don't always
		// report it; when they do and it differs, flag it for review rather
		// than refuse money that was already taken.
		if ev.CardName != "" && !NamesMatch(name, ev.CardName) {
			return flag(ctx, tx, userID, fmt.Sprintf("Card name %q doesn't match account name %q (top-up %s)", ev.CardName, name, ev.Reference))
		}
		return nil
	})
}

func flag(ctx context.Context, tx pgx.Tx, userID, reason string) error {
	if _, err := tx.Exec(ctx, `INSERT INTO fraud_flags (user_id, reason) VALUES ($1, $2)`, userID, reason); err != nil {
		return fmt.Errorf("flag: %w", err)
	}
	return nil
}

// NamesMatch is true when every word of the shorter name appears in the
// longer one, ignoring case, order and punctuation: "BAKARE TUNDE A" matches
// "Tunde Bakare".
func NamesMatch(account, card string) bool {
	a, c := nameWords(account), nameWords(card)
	if len(a) == 0 || len(c) == 0 {
		return false
	}
	short, long := a, c
	if len(short) > len(long) {
		short, long = long, short
	}
	have := map[string]bool{}
	for _, w := range long {
		have[w] = true
	}
	for _, w := range short {
		if !have[w] {
			return false
		}
	}
	return true
}

func nameWords(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r > 127)
	})
}

// TopUpStatus is where one top-up is, for the page the rep returns to.
type TopUpStatus struct {
	Reference string
	Status    string // pending, succeeded, failed
	Amount    int64
	CreatedAt time.Time
}

func (s *Service) TopUpStatus(ctx context.Context, u auth.User, reference string) (TopUpStatus, error) {
	t := TopUpStatus{Reference: reference}
	err := s.DB.QueryRow(ctx, `
		SELECT status, credited_microdollars, created_at FROM payments WHERE user_id = $1 AND provider_ref = $2`,
		u.ID, reference).Scan(&t.Status, &t.Amount, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return TopUpStatus{}, ErrNotFound
	}
	if err != nil {
		return TopUpStatus{}, fmt.Errorf("read top-up: %w", err)
	}
	return t, nil
}

// Summary is the top of the wallet screen.
type Summary struct {
	Balance  int64
	Held     int64
	Spent    map[ledger.Type]int64 // this calendar month, in the rep's time zone
	Activity []ledger.Entry
	Next     *ledger.Cursor
}

func (s *Service) Summary(ctx context.Context, u auth.User, now time.Time) (Summary, error) {
	var out Summary
	var err error
	if out.Balance, err = ledger.Balance(ctx, s.DB, u.ID); err != nil {
		return Summary{}, err
	}
	if out.Held, err = ledger.Held(ctx, s.DB, u.ID); err != nil {
		return Summary{}, err
	}
	from, _ := monthBounds(now, location(u.Timezone))
	if out.Spent, err = ledger.Spent(ctx, s.DB, u.ID, from); err != nil {
		return Summary{}, err
	}
	if out.Activity, out.Next, err = ledger.Activity(ctx, s.DB, u.ID, nil, 20); err != nil {
		return Summary{}, err
	}
	return out, nil
}

// monthBounds is the start of now's month and of the next, in loc.
func monthBounds(now time.Time, loc *time.Location) (time.Time, time.Time) {
	n := now.In(loc)
	from := time.Date(n.Year(), n.Month(), 1, 0, 0, 0, 0, loc)
	return from, from.AddDate(0, 1, 0)
}

func location(tz string) *time.Location {
	if loc, err := time.LoadLocation(tz); err == nil {
		return loc
	}
	return time.UTC
}

func (s *Service) logError(ctx context.Context, msg string, err error, args ...any) {
	l := s.Log
	if l == nil {
		l = slog.Default()
	}
	l.ErrorContext(ctx, msg, append([]any{"err", err}, args...)...)
}
