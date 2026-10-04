// Package telephony is the only code that talks to the phone provider
// (Telnyx today). Everything else uses the interfaces here, so moving to
// another provider, or to FreeSWITCH with a SIP trunk, only touches this
// package. Each piece has a real implementation and a fake for tests and
// development.
package telephony

import (
	"context"
	"errors"
)

// Numbers searches, buys and gives back phone numbers.
type Numbers interface {
	// Search lists local numbers for sale in an area code. country is "US"
	// or "CA"; areaCode is 3 digits.
	Search(ctx context.Context, country, areaCode string, limit int) ([]Available, error)
	// Order buys one number found by Search.
	Order(ctx context.Context, e164 string) (Ordered, error)
	// Release gives a number back, so it stops costing money.
	Release(ctx context.Context, e164 string) error
}

// Available is a number for sale.
type Available struct {
	E164 string
	// City is the number's area, like "New York, NY".
	City string
	// MonthlyCost is what the provider charges us each month, in micro-dollars.
	MonthlyCost int64
}

// Ordered is a number that is now ours.
type Ordered struct {
	E164        string
	ProviderID  string
	MonthlyCost int64
}

var (
	// ErrNumberGone means someone else bought the number first.
	ErrNumberGone = errors.New("telephony: number no longer available")
	// ErrProvider means the provider failed or answered something unexpected.
	ErrProvider = errors.New("telephony: provider error")
)
