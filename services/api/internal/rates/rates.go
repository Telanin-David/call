// Package rates turns a provider's per-minute cost into what a rep pays.
// Every amount is an integer in micro-dollars (1 USD = 1,000,000).
//
// Free, Starter and Pro differ only in the multiplier, stored on the plan as
// a whole percentage (250 = cost × 2.5). The same functions price a call
// before it starts (the hold) and after it ends (the charge), so the two can
// never disagree.
package rates

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/phone"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// ErrNoRate means no rate card covers the number, so it can't be dialled.
var ErrNoRate = errors.New("rates: no rate for this number")

// PricePerMinute is cost × multiplier, rounded half up to the micro-dollar.
func PricePerMinute(costPerMin int64, multiplierPct int) int64 {
	if costPerMin <= 0 || multiplierPct <= 0 {
		return 0
	}
	return (costPerMin*int64(multiplierPct) + 50) / 100
}

// Charge is what a call of the given length costs. Calls are billed per
// second, rounded up to the next micro-dollar so we never charge less than
// the provider bills us.
func Charge(pricePerMin, seconds int64) int64 {
	if pricePerMin <= 0 || seconds <= 0 {
		return 0
	}
	return (pricePerMin*seconds + 59) / 60
}

// HoldPerMinute is how much is set aside before dialling, and again at the
// start of each new minute: one minute at the call's price.
func HoldPerMinute(pricePerMin int64) int64 {
	return pricePerMin
}

// Quote is the price of calling one number on one plan.
type Quote struct {
	Country       string
	Prefix        string
	CostPerMin    int64
	MultiplierPct int
	PricePerMin   int64
}

// Hold is the amount to set aside before dialling.
func (q Quote) Hold() int64 { return HoldPerMinute(q.PricePerMin) }

// Charge is what a call of the given length costs.
func (q Quote) Charge(seconds int64) int64 { return Charge(q.PricePerMin, seconds) }

// Digits strips a phone number down to its digits ("+1 (415) 555-0100" →
// "14155550100"), the form rate-card prefixes are written in.
func Digits(number string) string {
	var b strings.Builder
	for _, r := range number {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// For prices a call to number on plan, using the longest rate-card prefix
// that matches the number and is already in effect.
func For(ctx context.Context, q platform.Querier, plan, number string) (Quote, error) {
	digits := Digits(number)
	if digits == "" {
		return Quote{}, ErrNoRate
	}
	var out Quote
	err := q.QueryRow(ctx, `
		SELECT r.country, r.prefix, r.cost_per_min, p.rate_multiplier_pct
		FROM rate_cards r, plans p
		WHERE p.id = $1
		  AND $2 LIKE r.prefix || '%'
		  AND r.started_at <= NOW()
		ORDER BY length(r.prefix) DESC, r.started_at DESC
		LIMIT 1`, plan, digits).Scan(&out.Country, &out.Prefix, &out.CostPerMin, &out.MultiplierPct)
	if errors.Is(err, pgx.ErrNoRows) {
		return Quote{}, ErrNoRate
	}
	if err != nil {
		return Quote{}, fmt.Errorf("look up rate: %w", err)
	}
	// The +1 card is for the US and Canada mainland. Jamaica, the other
	// Caribbean +1 countries and US territories cost far more, so they need
	// a card of their own (a longer prefix like 1876) before they can be
	// called.
	// (A bare "1", as the plans page asks for, is the card itself.)
	if out.Prefix == "1" && len(digits) > 1 && phone.RegionOf("+"+digits) != phone.USCA {
		return Quote{}, ErrNoRate
	}
	out.PricePerMin = PricePerMinute(out.CostPerMin, out.MultiplierPct)
	return out, nil
}
