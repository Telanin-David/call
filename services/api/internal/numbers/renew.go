package numbers

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// RenewResult counts what a renewal run did.
type RenewResult struct {
	Renewed  int
	Warned   int
	Released int
}

type action int

const (
	actDone action = iota
	actRenewed
	actRelease
)

// RenewDue renews every number whose month has run out: it charges the next
// month, releases numbers the rep cancelled, and after GraceDays releases
// numbers whose renewal couldn't be paid. Charges use one key per number
// per month, so running it twice, or on two workers, charges once.
func (s *Service) RenewDue(ctx context.Context, now time.Time) (RenewResult, error) {
	var res RenewResult
	rows, err := s.DB.Query(ctx, `SELECT id FROM numbers WHERE released_at IS NULL AND renews_at <= $1 ORDER BY renews_at`, platform.ToDate(now))
	if err != nil {
		return res, fmt.Errorf("list due numbers: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return res, fmt.Errorf("list due numbers: %w", err)
	}
	for _, id := range ids {
		if err := s.renew(ctx, id, now, &res); err != nil {
			s.log().ErrorContext(ctx, "number renewal failed", "number_id", id, "err", err)
		}
	}
	return res, nil
}

type due struct {
	userID, e164, name, email string
	renewsOn, createdAt       time.Time
	cancelOn                  *time.Time
	failedAt                  *time.Time
}

// renew catches one number up a month at a time.
func (s *Service) renew(ctx context.Context, id string, now time.Time, res *RenewResult) error {
	today := platform.ToDate(now)
	for i := 0; i < 24; i++ {
		var act action
		var mail *notify.Email
		var n due
		err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
			var userID string
			if err := tx.QueryRow(ctx, `SELECT user_id FROM numbers WHERE id = $1`, id).Scan(&userID); err != nil {
				return fmt.Errorf("read number owner: %w", err)
			}
			if err := ledger.Lock(ctx, tx, userID); err != nil {
				return err
			}
			var released *time.Time
			err := tx.QueryRow(ctx, `
				SELECT n.user_id, n.number, n.renews_at, n.created_at, n.cancel_on, n.renewal_failed_at, n.released_at, u.name, u.email
				FROM numbers n JOIN users u ON u.id = n.user_id WHERE n.id = $1 FOR UPDATE OF n`, id).
				Scan(&n.userID, &n.e164, &n.renewsOn, &n.createdAt, &n.cancelOn, &n.failedAt, &released, &n.name, &n.email)
			if err != nil {
				return fmt.Errorf("read number: %w", err)
			}
			n.renewsOn = platform.ToDate(n.renewsOn)
			if released != nil || n.renewsOn.After(today) {
				return nil
			}
			if n.cancelOn != nil && !n.cancelOn.After(today) {
				act = actRelease
				return nil
			}
			_, err = ledger.Debit(ctx, tx, ledger.Posting{
				UserID: n.userID, Type: ledger.TypeNumber, Amount: Price(), RefID: id,
				Description: fmt.Sprintf("Number %s, %s", Pretty(n.e164), n.renewsOn.Format("Jan 2006")),
				Key:         fmt.Sprintf("number:%s:renew:%s", id, n.renewsOn.Format("2006-01-02")),
			})
			if errors.Is(err, ledger.ErrInsufficientFunds) {
				return s.cannotPay(ctx, tx, id, n, now, res, &act, &mail)
			}
			if err != nil {
				return err
			}
			next := platform.AddMonths(n.renewsOn, 1, n.createdAt.UTC().Day())
			if _, err := tx.Exec(ctx, `UPDATE numbers SET renews_at = $2, renewal_failed_at = NULL WHERE id = $1`, id, next); err != nil {
				return fmt.Errorf("renew number: %w", err)
			}
			res.Renewed++
			act = actRenewed
			return nil
		})
		if err != nil {
			return err
		}
		if act == actRelease {
			if err := s.release(ctx, id, n.userID, n.e164); err != nil {
				return err
			}
			res.Released++
		}
		if mail != nil && s.Mail != nil {
			if err := s.Mail.SendEmail(ctx, *mail); err != nil {
				s.log().ErrorContext(ctx, "number email failed", "number_id", id, "err", err)
			}
		}
		if act != actRenewed {
			return nil
		}
	}
	return nil
}

// cannotPay starts the grace period on the first failed try, and releases
// the number once it has run out.
func (s *Service) cannotPay(ctx context.Context, tx pgx.Tx, id string, n due, now time.Time, res *RenewResult, act *action, mail **notify.Email) error {
	if n.failedAt == nil {
		if _, err := tx.Exec(ctx, `UPDATE numbers SET renewal_failed_at = $2 WHERE id = $1`, id, now); err != nil {
			return fmt.Errorf("start grace: %w", err)
		}
		res.Warned++
		*mail = &notify.Email{To: n.email, Subject: "Add money to keep " + Pretty(n.e164),
			Text: fmt.Sprintf("Hi %s,\n\nYour number %s renews today for %s a month, but your balance is too low. Add money by %s to keep it. After that the number is released and can't be got back.\n",
				firstName(n.name), Pretty(n.e164), dollars(Price()), now.Add(GraceDays*24*time.Hour).Format("2 Jan"))}
		return nil
	}
	if now.Sub(*n.failedAt) < GraceDays*24*time.Hour {
		return nil // still in grace; try again next run
	}
	*act = actRelease
	*mail = &notify.Email{To: n.email, Subject: Pretty(n.e164) + " was released",
		Text: fmt.Sprintf("Hi %s,\n\nYour number %s was released because its renewal couldn't be paid. You can rent another number any time from Settings.\n",
			firstName(n.name), Pretty(n.e164))}
	return nil
}

// release gives the number back to the provider first, then marks it
// released. If the provider can't be reached, nothing is marked, and the
// next run tries again; the rep is never charged in between.
func (s *Service) release(ctx context.Context, id, userID, e164 string) error {
	if s.Provider == nil {
		return ErrUnavailable
	}
	if err := s.Provider.Release(ctx, e164); err != nil {
		return fmt.Errorf("release %s: %w", e164, err)
	}
	return platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var wasDefault bool
		err := tx.QueryRow(ctx, `SELECT is_default FROM numbers WHERE id = $1 AND released_at IS NULL FOR UPDATE`, id).Scan(&wasDefault)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read number: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE numbers SET released_at = now(), is_default = false WHERE id = $1`, id); err != nil {
			return fmt.Errorf("mark released: %w", err)
		}
		if !wasDefault {
			return nil
		}
		// The oldest number left becomes the default.
		if _, err := tx.Exec(ctx, `
			UPDATE numbers SET is_default = true WHERE id = (
				SELECT id FROM numbers WHERE user_id = $1 AND released_at IS NULL ORDER BY created_at LIMIT 1)`, userID); err != nil {
			return fmt.Errorf("move default: %w", err)
		}
		return nil
	})
}
