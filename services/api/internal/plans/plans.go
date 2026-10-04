// Package plans runs Free, Starter and Pro: what each costs, moving between
// them, and monthly renewals. Plan fees come out of the balance through the
// ledger like everything else.
//
// A rep with no subscriptions row is on Free. Moving up starts at once and
// is paid today; moving down waits for the next renewal, so the rep keeps
// what they paid for. The intro price is for a rep's first paid plan only.
package plans

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/rates"
)

// Free is the plan with no subscription.
const Free = "free"

// Plan is one row of the plans table.
type Plan struct {
	ID            string
	MonthlyFee    int64 // micro-dollars, after the intro months
	IntroFee      int64 // micro-dollars, during the intro months
	IntroMonths   int
	MultiplierPct int
	DialsPerDay   *int // nil means no limit
	Features      []string
	// USPricePerMin is what a minute to the US or Canada costs on this plan.
	USPricePerMin int64
}

// Rank orders plans from Free up.
func Rank(id string) int {
	switch id {
	case "starter":
		return 1
	case "pro":
		return 2
	}
	return 0
}

// Error is a failure the rep can act on.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return "plans: " + e.Code }

var (
	ErrUnknownPlan = &Error{http.StatusUnprocessableEntity, "unknown_plan", "Pick Free, Starter or Pro."}
	ErrLowBalance  = &Error{http.StatusPaymentRequired, "low_balance", "Your balance is too low for this. Add money and try again."}
)

// List returns every plan, cheapest first.
func List(ctx context.Context, q platform.Querier) ([]Plan, error) {
	rows, err := q.Query(ctx, `
		SELECT id, monthly_fee_microdollars, intro_fee_microdollars, intro_months, rate_multiplier_pct, dials_per_day, features
		FROM plans ORDER BY monthly_fee_microdollars`)
	if err != nil {
		return nil, fmt.Errorf("list plans: %w", err)
	}
	defer rows.Close()
	var out []Plan
	for rows.Next() {
		var p Plan
		if err := rows.Scan(&p.ID, &p.MonthlyFee, &p.IntroFee, &p.IntroMonths, &p.MultiplierPct, &p.DialsPerDay, &p.Features); err != nil {
			return nil, fmt.Errorf("scan plan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list plans: %w", err)
	}
	for i := range out {
		// The same rate function the ledger charges with (plan section 10).
		quote, err := rates.For(ctx, q, out[i].ID, "1")
		if err != nil && !errors.Is(err, rates.ErrNoRate) {
			return nil, err
		}
		out[i].USPricePerMin = quote.PricePerMin
	}
	return out, nil
}

// Get returns one plan.
func Get(ctx context.Context, q platform.Querier, id string) (Plan, error) {
	all, err := List(ctx, q)
	if err != nil {
		return Plan{}, err
	}
	for _, p := range all {
		if p.ID == id {
			return p, nil
		}
	}
	return Plan{}, ErrUnknownPlan
}

// Subscription is a rep's paid plan.
type Subscription struct {
	UserID          string
	PlanID          string
	StartedAt       time.Time
	IntroEndsAt     *time.Time
	NextRenewal     time.Time // a date, midnight UTC
	PendingChange   string    // plan to move to at renewal, or ""
	RenewalFailedAt *time.Time
}

const subCols = `user_id, plan_id, started_at, intro_ends_at, next_renewal, COALESCE(pending_downgrade, ''), renewal_failed_at`

func scanSub(row pgx.Row) (Subscription, error) {
	var s Subscription
	err := row.Scan(&s.UserID, &s.PlanID, &s.StartedAt, &s.IntroEndsAt, &s.NextRenewal, &s.PendingChange, &s.RenewalFailedAt)
	s.NextRenewal = toDate(s.NextRenewal)
	return s, err
}

// Current returns the rep's subscription; ok is false on Free.
func Current(ctx context.Context, q platform.Querier, userID string) (Subscription, bool, error) {
	return current(ctx, q, userID, "")
}

func current(ctx context.Context, q platform.Querier, userID, lock string) (Subscription, bool, error) {
	s, err := scanSub(q.QueryRow(ctx, `SELECT `+subCols+` FROM subscriptions WHERE user_id = $1 `+lock, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Subscription{}, false, nil
	}
	if err != nil {
		return Subscription{}, false, fmt.Errorf("read subscription: %w", err)
	}
	return s, true, nil
}

// feeAt is what a plan costs for the month starting on day: the intro
// price while the intro lasts, the full price after.
func feeAt(p Plan, introEnds *time.Time, day time.Time) int64 {
	if introEnds != nil && day.Before(*introEnds) {
		return p.IntroFee
	}
	return p.MonthlyFee
}

// The monthly date maths is shared with numbers.
var (
	toDate    = platform.ToDate
	addMonths = platform.AddMonths
)

// days counts whole days from a to b.
func days(a, b time.Time) int64 {
	return int64(toDate(b).Sub(toDate(a)).Hours() / 24)
}
