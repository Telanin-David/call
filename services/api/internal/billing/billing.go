// Package billing talks to the card payment providers: Paystack for cards
// from Nigeria, Ghana and Kenya, and Stripe for everyone else. Reps pay on
// the provider's own checkout page, so card numbers never touch our servers.
//
// A top-up only counts when the provider's webhook says it was paid; package
// wallet credits the ledger then. Every webhook's signature is checked
// before anything in it is read (CLAUDE.md rule 6).
package billing

import (
	"context"
	"errors"
	"net/http"
	"strings"
)

// Checkout is one payment the rep is about to make.
type Checkout struct {
	// Reference is ours, unique per payment; the provider echoes it back.
	Reference string
	Email     string
	// AmountMinor is in the currency's smallest unit (cents, kobo).
	AmountMinor int64
	Currency    string // ISO 4217, upper case: "USD", "NGN"
	// ReturnURL is where the provider sends the rep afterwards.
	ReturnURL string
	CancelURL string
}

// EventKind is what a webhook tells us about a payment.
type EventKind int

const (
	// Ignored: a webhook we don't act on (other event types).
	Ignored EventKind = iota
	// Paid: the money was taken.
	Paid
	// Failed: the payment will never complete (expired, declined).
	Failed
)

// Event is a verified webhook, reduced to what the wallet needs.
type Event struct {
	Kind        EventKind
	Reference   string
	AmountMinor int64
	Currency    string // upper case
	CardLast4   string
	CardName    string // the name the provider saw, if it reports one
}

// Provider is one payment company.
type Provider interface {
	Name() string
	// StartCheckout returns the page the rep pays on.
	StartCheckout(ctx context.Context, c Checkout) (string, error)
	// ParseWebhook checks the signature first, then reads the event.
	ParseWebhook(h http.Header, body []byte) (Event, error)
}

var (
	// ErrBadSignature means the webhook didn't come from the provider.
	ErrBadSignature = errors.New("billing: webhook signature is wrong")
	// ErrProvider wraps a refusal from the provider's API.
	ErrProvider = errors.New("billing: provider refused the request")
)

// paystackCountries are where Paystack issues cards. Everyone else uses Stripe.
var paystackCountries = map[string]bool{"NG": true, "GH": true, "KE": true}

// ProviderFor names the provider for a rep's country ("NG" → "paystack").
func ProviderFor(country string) string {
	if paystackCountries[strings.ToUpper(country)] {
		return "paystack"
	}
	return "stripe"
}
