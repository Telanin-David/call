package plans

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// GraceDays is how long a rep has to top up after a renewal can't be paid,
// before moving to Free (open decision 4, suggested default).
const GraceDays = 3

const microPerCent = 10_000

// Service changes plans and renews them.
type Service struct {
	DB   *pgxpool.Pool
	Mail notify.Mailer
	Log  *slog.Logger
}

// Kind is what a change of plan does.
type Kind string

const (
	// Upgrade starts now and is paid today.
	Upgrade Kind = "upgrade"
	// Downgrade waits for the next renewal.
	Downgrade Kind = "downgrade"
	// Stay keeps the current plan and cancels a waiting downgrade.
	Stay Kind = "stay"
)

// Quote is what a change of plan means, shown before the rep confirms.
type Quote struct {
	From, To     string
	Kind         Kind
	DueToday     int64     // micro-dollars taken now
	Intro        bool      // the new plan is at its intro price
	StartsOn     time.Time // when the new plan begins
	NextRenewal  time.Time // zero on Free
	NextCharge   int64     // what the next renewal will cost
	Balance      int64
	BalanceAfter int64
}

// Quote works out a change of plan without making it.
func (s *Service) Quote(ctx context.Context, u auth.User, to string, now time.Time) (Quote, error) {
	return s.quote(ctx, s.DB, u, to, now, "")
}

func (s *Service) quote(ctx context.Context, q platform.Querier, u auth.User, to string, now time.Time, lock string) (Quote, error) {
	target, err := Get(ctx, q, to)
	if err != nil {
		return Quote{}, err
	}
	sub, paid, err := current(ctx, q, u.ID, lock)
	if err != nil {
		return Quote{}, err
	}
	bal, err := ledger.Balance(ctx, q, u.ID)
	if err != nil {
		return Quote{}, err
	}
	today := toDate(now)
	from := Free
	if paid {
		from = sub.PlanID
	}
	out := Quote{From: from, To: to, Balance: bal}

	switch {
	case Rank(to) > Rank(from) && !paid:
		// Free to a paid plan: the first month today, intro price if it's
		// the rep's first paid plan.
		introEnds, err := s.introEnds(ctx, q, u.ID, target, now)
		if err != nil {
			return Quote{}, err
		}
		out.Kind = Upgrade
		out.Intro = introEnds != nil
		out.DueToday = feeAt(target, introEnds, today)
		out.StartsOn = today
		out.NextRenewal = addMonths(today, 1, today.Day())
		out.NextCharge = feeAt(target, introEnds, out.NextRenewal)

	case Rank(to) > Rank(from):
		// Up from a paid plan: the difference for the days left this month.
		cur, err := Get(ctx, q, from)
		if err != nil {
			return Quote{}, err
		}
		anchor := sub.StartedAt.UTC().Day()
		prev := addMonths(sub.NextRenewal, -1, anchor)
		diff := feeAt(target, sub.IntroEndsAt, prev) - feeAt(cur, sub.IntroEndsAt, prev)
		out.Kind = Upgrade
		out.Intro = sub.IntroEndsAt != nil && prev.Before(*sub.IntroEndsAt)
		out.DueToday = prorate(diff, days(today, sub.NextRenewal), days(prev, sub.NextRenewal))
		out.StartsOn = today
		out.NextRenewal = sub.NextRenewal
		out.NextCharge = feeAt(target, sub.IntroEndsAt, sub.NextRenewal)

	case Rank(to) < Rank(from):
		out.Kind = Downgrade
		out.StartsOn = sub.NextRenewal
		if to != Free {
			out.NextRenewal = sub.NextRenewal
			out.NextCharge = feeAt(target, sub.IntroEndsAt, sub.NextRenewal)
		}

	default:
		out.Kind = Stay
		out.StartsOn = today
		if paid {
			cur, err := Get(ctx, q, from)
			if err != nil {
				return Quote{}, err
			}
			out.NextRenewal = sub.NextRenewal
			out.NextCharge = feeAt(cur, sub.IntroEndsAt, sub.NextRenewal)
		}
	}
	out.BalanceAfter = bal - out.DueToday
	return out, nil
}

// introEnds is when the intro price would end for a rep starting a paid
// plan now, or nil if they've had it before (open decision 9 default: no
// second intro).
func (s *Service) introEnds(ctx context.Context, q platform.Querier, userID string, p Plan, now time.Time) (*time.Time, error) {
	var used bool
	if err := q.QueryRow(ctx, `SELECT intro_used FROM users WHERE id = $1`, userID).Scan(&used); err != nil {
		return nil, fmt.Errorf("read intro: %w", err)
	}
	if used || p.IntroMonths == 0 {
		return nil, nil
	}
	today := toDate(now)
	end := addMonths(today, p.IntroMonths, today.Day())
	return &end, nil
}

// prorate is diff × left/period, rounded up to a whole cent.
func prorate(diff, left, period int64) int64 {
	if diff <= 0 || left <= 0 || period <= 0 {
		return 0
	}
	if left > period {
		left = period
	}
	micro := (diff*left + period - 1) / period
	return (micro + microPerCent - 1) / microPerCent * microPerCent
}

// Change makes the change Quote describes. Upgrades are paid from the
// balance now, or fail with ErrLowBalance; downgrades are booked for the
// next renewal; choosing the current plan cancels a booked downgrade.
func (s *Service) Change(ctx context.Context, u auth.User, to string, now time.Time) (Quote, error) {
	var q Quote
	err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		// The ledger lock first, then the row: every money path for this
		// rep queues behind one lock, so a double tap can't pay twice.
		if err := ledger.Lock(ctx, tx, u.ID); err != nil {
			return err
		}
		var err error
		if q, err = s.quote(ctx, tx, u, to, now, "FOR UPDATE"); err != nil {
			return err
		}
		switch q.Kind {
		case Upgrade:
			return s.upgrade(ctx, tx, u, q, now)
		case Downgrade:
			_, err := tx.Exec(ctx, `UPDATE subscriptions SET pending_downgrade = $2 WHERE user_id = $1`, u.ID, q.To)
			return wrap("book downgrade", err)
		default:
			_, err := tx.Exec(ctx, `UPDATE subscriptions SET pending_downgrade = NULL WHERE user_id = $1`, u.ID)
			return wrap("cancel downgrade", err)
		}
	})
	return q, err
}

func (s *Service) upgrade(ctx context.Context, tx pgx.Tx, u auth.User, q Quote, now time.Time) error {
	if q.DueToday > 0 {
		desc := fmt.Sprintf("%s plan, first month", label(q.To))
		if q.From != Free {
			desc = fmt.Sprintf("Upgrade to %s, rest of this month", label(q.To))
		}
		if q.Intro {
			desc += " (intro price)"
		}
		_, err := ledger.Debit(ctx, tx, ledger.Posting{
			UserID: u.ID, Type: ledger.TypePlan, Amount: q.DueToday, Description: desc,
			Key: fmt.Sprintf("plan:%s:%s:%s", u.ID, q.To, now.UTC().Format(time.RFC3339Nano)),
		})
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return ErrLowBalance
		}
		if err != nil {
			return err
		}
	}
	if q.From == Free {
		var introEnds *time.Time
		if q.Intro {
			p, err := Get(ctx, tx, q.To)
			if err != nil {
				return err
			}
			end := addMonths(q.StartsOn, p.IntroMonths, q.StartsOn.Day())
			introEnds = &end
			if _, err := tx.Exec(ctx, `UPDATE users SET intro_used = true WHERE id = $1`, u.ID); err != nil {
				return wrap("mark intro used", err)
			}
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO subscriptions (user_id, plan_id, started_at, intro_ends_at, next_renewal)
			VALUES ($1, $2, $3, $4, $5)`, u.ID, q.To, now, introEnds, q.NextRenewal)
		return wrap("start subscription", err)
	}
	_, err := tx.Exec(ctx, `UPDATE subscriptions SET plan_id = $2, pending_downgrade = NULL WHERE user_id = $1`, u.ID, q.To)
	return wrap("upgrade subscription", err)
}

// RenewResult counts what one renewal run did.
type RenewResult struct {
	Renewed, MovedDown, Warned, MovedToFree int
}

// RenewDue renews every subscription due by now. It is safe to run often
// and from more than one worker: each rep is renewed in its own
// transaction, rows are locked, and the charge's idempotency key is the
// renewal date, so a month is never charged twice.
func (s *Service) RenewDue(ctx context.Context, now time.Time) (RenewResult, error) {
	var res RenewResult
	rows, err := s.DB.Query(ctx, `SELECT user_id FROM subscriptions WHERE next_renewal <= $1 ORDER BY next_renewal`, toDate(now))
	if err != nil {
		return res, fmt.Errorf("list due renewals: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return res, fmt.Errorf("list due renewals: %w", err)
	}
	for _, id := range ids {
		if err := s.renew(ctx, id, now, &res); err != nil {
			s.log().ErrorContext(ctx, "renewal failed", "user_id", id, "err", err)
		}
	}
	return res, nil
}

// renew catches one rep up, a month at a time, until their next renewal is
// in the future or a renewal can't be paid.
func (s *Service) renew(ctx context.Context, userID string, now time.Time, res *RenewResult) error {
	today := toDate(now)
	for i := 0; i < 24; i++ { // a worker down for two years is a different problem
		var mail *notify.Email
		var done bool
		err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
			if err := ledger.Lock(ctx, tx, userID); err != nil {
				return err
			}
			sub, ok, err := current(ctx, tx, userID, "FOR UPDATE")
			if err != nil {
				return err
			}
			if !ok || sub.NextRenewal.After(today) {
				done = true
				return nil
			}
			u, err := auth.ScanUser(tx.QueryRow(ctx, `SELECT `+auth.UserCols+` FROM users WHERE id = $1`, userID))
			if err != nil {
				return wrap("read user", err)
			}

			if sub.PendingChange == Free {
				if _, err := tx.Exec(ctx, `DELETE FROM subscriptions WHERE user_id = $1`, userID); err != nil {
					return wrap("move to free", err)
				}
				res.MovedToFree++
				mail = &notify.Email{To: u.Email, Subject: "You're on Free now",
					Text: fmt.Sprintf("Hi %s,\n\nAs you asked, your plan moved to Free today. Your leads, follow-ups and history are all still there.\n", first(u.Name))}
				done = true
				return nil
			}
			planID := sub.PlanID
			if sub.PendingChange != "" {
				planID = sub.PendingChange
			}
			p, err := Get(ctx, tx, planID)
			if err != nil {
				return err
			}
			fee := feeAt(p, sub.IntroEndsAt, sub.NextRenewal)
			_, err = ledger.Debit(ctx, tx, ledger.Posting{
				UserID: userID, Type: ledger.TypePlan, Amount: fee,
				Description: fmt.Sprintf("%s plan, %s", label(planID), sub.NextRenewal.Format("Jan 2006")),
				Key:         fmt.Sprintf("plan:%s:renew:%s", userID, sub.NextRenewal.Format("2006-01-02")),
			})
			if errors.Is(err, ledger.ErrInsufficientFunds) {
				done = true
				return s.cannotPay(ctx, tx, u, sub, p, fee, now, res, &mail)
			}
			if err != nil {
				return err
			}
			next := addMonths(sub.NextRenewal, 1, sub.StartedAt.UTC().Day())
			if _, err := tx.Exec(ctx, `
				UPDATE subscriptions SET plan_id = $2, pending_downgrade = NULL, next_renewal = $3, renewal_failed_at = NULL
				WHERE user_id = $1`, userID, planID, next); err != nil {
				return wrap("renew", err)
			}
			if sub.PendingChange != "" {
				res.MovedDown++
			}
			res.Renewed++
			return nil
		})
		if err != nil {
			return err
		}
		if mail != nil {
			if err := s.Mail.SendEmail(ctx, *mail); err != nil {
				s.log().ErrorContext(ctx, "renewal email failed", "user_id", userID, "err", err)
			}
		}
		if done {
			return nil
		}
	}
	return nil
}

// cannotPay starts the grace period on the first failed try, and moves the
// rep to Free once it has run out.
func (s *Service) cannotPay(ctx context.Context, tx pgx.Tx, u auth.User, sub Subscription, p Plan, fee int64, now time.Time, res *RenewResult, mail **notify.Email) error {
	if sub.RenewalFailedAt == nil {
		if _, err := tx.Exec(ctx, `UPDATE subscriptions SET renewal_failed_at = $2 WHERE user_id = $1`, u.ID, now); err != nil {
			return wrap("start grace", err)
		}
		res.Warned++
		deadline := now.Add(GraceDays * 24 * time.Hour)
		*mail = &notify.Email{To: u.Email, Subject: "Add money to keep " + label(p.ID),
			Text: fmt.Sprintf("Hi %s,\n\nYour %s plan renews today for %s, but your balance is too low. Add money by %s to keep it. After that you'll move to Free; your leads and history stay.\n",
				first(u.Name), label(p.ID), dollars(fee), deadline.Format("2 Jan"))}
		return nil
	}
	if now.Sub(*sub.RenewalFailedAt) < GraceDays*24*time.Hour {
		return nil // still in grace; try again next run
	}
	if _, err := tx.Exec(ctx, `DELETE FROM subscriptions WHERE user_id = $1`, u.ID); err != nil {
		return wrap("drop to free", err)
	}
	res.MovedToFree++
	*mail = &notify.Email{To: u.Email, Subject: "You're on Free now",
		Text: fmt.Sprintf("Hi %s,\n\nWe couldn't renew %s, so you're on Free now. Your leads, follow-ups and history are all still there. Add money and upgrade any time.\n", first(u.Name), label(p.ID))}
	return nil
}

func label(id string) string {
	switch id {
	case "starter":
		return "Starter"
	case "pro":
		return "Pro"
	}
	return "Free"
}

func first(name string) string {
	for i, r := range name {
		if r == ' ' {
			return name[:i]
		}
	}
	return name
}

// dollars shows a fee to the cent ("$15.00"). Fees are whole cents.
func dollars(micro int64) string {
	cents := (micro + microPerCent/2) / microPerCent
	return fmt.Sprintf("$%d.%02d", cents/100, cents%100)
}

func wrap(what string, err error) error {
	if err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	return nil
}

func (s *Service) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}
