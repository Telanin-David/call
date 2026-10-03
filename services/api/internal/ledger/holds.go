package ledger

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/platform"
)

// HoldStatus is where a hold is in its life (the hold_status enum).
type HoldStatus string

const (
	HoldOpen     HoldStatus = "open"
	HoldSettled  HoldStatus = "settled"
	HoldReleased HoldStatus = "released"
)

var (
	// ErrHoldNotFound means no hold has that id.
	ErrHoldNotFound = errors.New("ledger: hold not found")
	// ErrHoldClosed means the hold was already settled or released.
	ErrHoldClosed = errors.New("ledger: hold already closed")
	// ErrChargeAboveHold means the charge is more than was set aside. The
	// dialer must extend the hold before each new minute and end the call
	// when it can't, so this never happens to a correct caller.
	ErrChargeAboveHold = errors.New("ledger: charge is more than the hold")
)

// Hold is money set aside while a call runs.
type Hold struct {
	ID        string
	UserID    string
	RefID     string
	Amount    int64
	Status    HoldStatus
	CreatedAt time.Time
	ClosedAt  *time.Time
}

const holdCols = `id, user_id, COALESCE(ref_id::text, ''), amount_microdollars, status, created_at, closed_at`

func scanHold(row pgx.Row) (Hold, error) {
	var h Hold
	var status string
	err := row.Scan(&h.ID, &h.UserID, &h.RefID, &h.Amount, &status, &h.CreatedAt, &h.ClosedAt)
	h.Status = HoldStatus(status)
	return h, err
}

// GetHold reads one hold.
func GetHold(ctx context.Context, q platform.Querier, holdID string) (Hold, error) {
	h, err := scanHold(q.QueryRow(ctx, `SELECT `+holdCols+` FROM holds WHERE id = $1`, holdID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Hold{}, ErrHoldNotFound
	}
	if err != nil {
		return Hold{}, fmt.Errorf("read hold: %w", err)
	}
	return h, nil
}

// Held is the total currently set aside for running calls. It is already
// taken off Balance; the wallet shows it as "held for a call".
func Held(ctx context.Context, q platform.Querier, userID string) (int64, error) {
	var n int64
	err := q.QueryRow(ctx, `SELECT COALESCE(SUM(amount_microdollars), 0)::BIGINT FROM holds WHERE user_id = $1 AND status = 'open'`, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("read held: %w", err)
	}
	return n, nil
}

// PlaceHold sets money aside before dialling. refID is the call it is for.
// It fails with ErrInsufficientFunds if the balance can't cover it.
func PlaceHold(ctx context.Context, tx pgx.Tx, userID, refID string, amount int64, key string) (Hold, error) {
	if amount <= 0 {
		return Hold{}, ErrBadAmount
	}
	if key == "" {
		return Hold{}, ErrNoKey
	}
	if err := Lock(ctx, tx, userID); err != nil {
		return Hold{}, err
	}
	if prev, ok, err := byKey(ctx, tx, key); err != nil {
		return Hold{}, err
	} else if ok {
		if prev.UserID != userID || prev.Type != TypeHold || prev.RefID == "" {
			return Hold{}, ErrKeyReused
		}
		h, err := GetHold(ctx, tx, prev.RefID)
		if err != nil {
			return Hold{}, err
		}
		if h.RefID != refID || -prev.Amount != amount {
			return Hold{}, ErrKeyReused
		}
		return h, nil
	}
	bal, err := Balance(ctx, tx, userID)
	if err != nil {
		return Hold{}, err
	}
	if bal < amount {
		return Hold{}, ErrInsufficientFunds
	}

	h, err := scanHold(tx.QueryRow(ctx, `
		INSERT INTO holds (user_id, ref_id, amount_microdollars) VALUES ($1, NULLIF($2, '')::uuid, $3)
		RETURNING `+holdCols, userID, refID, amount))
	if err != nil {
		return Hold{}, fmt.Errorf("insert hold: %w", err)
	}
	if _, err := insertHoldEntry(ctx, tx, h, TypeHold, -amount, "Held for a call", key); err != nil {
		return Hold{}, err
	}
	return h, nil
}

// ExtendHold sets aside more money for a call that is still running, at the
// start of each new minute. ErrInsufficientFunds means the rep has run out:
// warn them and end the call.
func ExtendHold(ctx context.Context, tx pgx.Tx, holdID string, more int64, key string) (Hold, error) {
	if more <= 0 {
		return Hold{}, ErrBadAmount
	}
	if key == "" {
		return Hold{}, ErrNoKey
	}
	h, err := lockHold(ctx, tx, holdID)
	if err != nil {
		return Hold{}, err
	}
	if prev, ok, err := byKey(ctx, tx, key); err != nil {
		return Hold{}, err
	} else if ok {
		if prev.UserID != h.UserID || prev.Type != TypeHold || prev.RefID != h.ID || -prev.Amount != more {
			return Hold{}, ErrKeyReused
		}
		return h, nil
	}
	if h.Status != HoldOpen {
		return Hold{}, ErrHoldClosed
	}
	bal, err := Balance(ctx, tx, h.UserID)
	if err != nil {
		return Hold{}, err
	}
	if bal < more {
		return Hold{}, ErrInsufficientFunds
	}
	if _, err := insertHoldEntry(ctx, tx, h, TypeHold, -more, "Held for a call", key); err != nil {
		return Hold{}, err
	}
	h, err = scanHold(tx.QueryRow(ctx, `
		UPDATE holds SET amount_microdollars = amount_microdollars + $2 WHERE id = $1
		RETURNING `+holdCols, h.ID, more))
	if err != nil {
		return Hold{}, fmt.Errorf("extend hold: %w", err)
	}
	return h, nil
}

// Settle ends a hold with the exact charge for the call: the whole hold comes
// back and the charge goes out, so the rep pays only for the seconds used.
// The returned entry is the charge (a zero Entry when charge is 0). Settling
// the same hold again with the same charge is a no-op that returns the
// original charge.
func Settle(ctx context.Context, tx pgx.Tx, holdID string, charge int64, description string) (Entry, error) {
	if charge < 0 {
		return Entry{}, ErrBadAmount
	}
	h, err := lockHold(ctx, tx, holdID)
	if err != nil {
		return Entry{}, err
	}
	chargeKey := "hold:" + h.ID + ":charge"
	switch h.Status {
	case HoldSettled:
		prev, ok, err := byKey(ctx, tx, chargeKey)
		if err != nil {
			return Entry{}, err
		}
		if !ok {
			prev = Entry{}
		}
		if -prev.Amount != charge {
			return Entry{}, ErrHoldClosed
		}
		prev.Replayed = true
		return prev, nil
	case HoldReleased:
		return Entry{}, ErrHoldClosed
	}
	if charge > h.Amount {
		return Entry{}, ErrChargeAboveHold
	}

	if _, err := insertHoldEntry(ctx, tx, h, TypeRelease, h.Amount, "Hold returned", "hold:"+h.ID+":release"); err != nil {
		return Entry{}, err
	}
	var out Entry
	if charge > 0 {
		out = Entry{UserID: h.UserID, Type: TypeCall, Amount: -charge, Description: description, Key: chargeKey, RefID: h.RefID}
		err := tx.QueryRow(ctx, `
			INSERT INTO ledger_entries (user_id, type, amount_microdollars, description, idempotency_key, ref_id)
			VALUES ($1, 'call', $2, $3, $4, NULLIF($5, '')::uuid)
			RETURNING id, created_at`,
			h.UserID, -charge, description, chargeKey, h.RefID).Scan(&out.ID, &out.CreatedAt)
		if err != nil {
			return Entry{}, fmt.Errorf("insert call charge: %w", err)
		}
	}
	if err := closeHold(ctx, tx, h.ID, HoldSettled); err != nil {
		return Entry{}, err
	}
	return out, nil
}

// Release gives a whole hold back, for a call that never connected.
// Releasing an already released hold is a no-op.
func Release(ctx context.Context, tx pgx.Tx, holdID string) error {
	h, err := lockHold(ctx, tx, holdID)
	if err != nil {
		return err
	}
	switch h.Status {
	case HoldReleased:
		return nil
	case HoldSettled:
		return ErrHoldClosed
	}
	if _, err := insertHoldEntry(ctx, tx, h, TypeRelease, h.Amount, "Hold returned", "hold:"+h.ID+":release"); err != nil {
		return err
	}
	return closeHold(ctx, tx, h.ID, HoldReleased)
}

// lockHold takes the user's ledger lock, then reads the hold under it.
func lockHold(ctx context.Context, tx pgx.Tx, holdID string) (Hold, error) {
	h, err := GetHold(ctx, tx, holdID)
	if err != nil {
		return Hold{}, err
	}
	if err := Lock(ctx, tx, h.UserID); err != nil {
		return Hold{}, err
	}
	// Re-read: the hold may have changed while we waited for the lock.
	return GetHold(ctx, tx, holdID)
}

func insertHoldEntry(ctx context.Context, tx pgx.Tx, h Hold, typ Type, amount int64, description, key string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO ledger_entries (user_id, type, amount_microdollars, description, idempotency_key, ref_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id`,
		h.UserID, string(typ), amount, description, key, h.ID).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert %s entry: %w", typ, err)
	}
	return id, nil
}

func closeHold(ctx context.Context, tx pgx.Tx, holdID string, status HoldStatus) error {
	_, err := tx.Exec(ctx, `UPDATE holds SET status = $2, closed_at = NOW() WHERE id = $1`, holdID, string(status))
	if err != nil {
		return fmt.Errorf("close hold: %w", err)
	}
	return nil
}
