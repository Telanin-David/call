// Package ledger owns every movement of money (CLAUDE.md rule 1). Amounts are
// integers in micro-dollars (1 USD = 1,000,000); there are no floats here.
//
// A user's balance is the sum of their ledger entries. Nothing else stores a
// balance, so it can't drift. Money set aside for a running call is a 'hold'
// entry (negative), so the balance is always what the rep can still spend.
//
// Every write takes a pgx.Tx: callers combine ledger writes with their own
// (marking a payment paid, ending a call) so both land or neither does. Every
// write also takes an idempotency key: the same key twice returns the first
// entry instead of moving the money again, so retried webhooks and jobs are
// safe.
package ledger

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/platform"
)

// Type is the kind of money movement (the ledger_type enum).
type Type string

const (
	TypeTopUp   Type = "topup"
	TypeCall    Type = "call"
	TypeHold    Type = "hold"
	TypeRelease Type = "release"
	TypeNumber  Type = "number"
	TypePlan    Type = "plan"
	TypeRefund  Type = "refund"
)

// credit reports whether money of this type goes in (true) or out (false).
func (t Type) credit() (bool, error) {
	switch t {
	case TypeTopUp, TypeRelease, TypeRefund:
		return true, nil
	case TypeCall, TypeHold, TypeNumber, TypePlan:
		return false, nil
	}
	return false, fmt.Errorf("ledger: unknown entry type %q", t)
}

var (
	// ErrInsufficientFunds means the balance can't cover the debit.
	ErrInsufficientFunds = errors.New("ledger: balance too low")
	// ErrBadAmount means the amount was zero or negative.
	ErrBadAmount = errors.New("ledger: amount must be above zero")
	// ErrWrongDirection means a debit type was credited or the reverse.
	ErrWrongDirection = errors.New("ledger: wrong direction for this entry type")
	// ErrNoKey means the idempotency key was empty.
	ErrNoKey = errors.New("ledger: idempotency key required")
	// ErrKeyReused means the key was already used for a different movement.
	ErrKeyReused = errors.New("ledger: idempotency key already used for a different entry")
)

// Posting is a request to move money. Amount is always positive; Credit and
// Debit decide the sign.
type Posting struct {
	UserID      string
	Type        Type
	Amount      int64
	Description string
	// Key makes the posting idempotent, e.g. "paystack:<reference>".
	Key string
	// RefID optionally links the entry to a payment, call, number or hold.
	RefID string
}

// Entry is one row of the ledger. Amount is signed: positive in, negative out.
type Entry struct {
	ID          string
	UserID      string
	Type        Type
	Amount      int64
	Description string
	Key         string
	RefID       string
	CreatedAt   time.Time
	// Replayed is true when the key had already been used and this is the
	// original entry, not a new one.
	Replayed bool
}

// Lock serialises money movements for one user until the transaction ends,
// so two debits can't both see the same balance and overdraw it.
func Lock(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('ledger:' || $1, 0))`, userID); err != nil {
		return fmt.Errorf("lock ledger: %w", err)
	}
	return nil
}

// Balance is what the user can spend now: every entry summed, with open
// holds already taken off.
func Balance(ctx context.Context, q platform.Querier, userID string) (int64, error) {
	var b int64
	err := q.QueryRow(ctx, `SELECT COALESCE(SUM(amount_microdollars), 0)::BIGINT FROM ledger_entries WHERE user_id = $1`, userID).Scan(&b)
	if err != nil {
		return 0, fmt.Errorf("read balance: %w", err)
	}
	return b, nil
}

// Credit adds money (top-up, refund, release).
func Credit(ctx context.Context, tx pgx.Tx, p Posting) (Entry, error) {
	return post(ctx, tx, p, true)
}

// Debit takes money (call, plan fee, number rent, hold). It fails with
// ErrInsufficientFunds rather than let the balance go below zero.
func Debit(ctx context.Context, tx pgx.Tx, p Posting) (Entry, error) {
	return post(ctx, tx, p, false)
}

func post(ctx context.Context, tx pgx.Tx, p Posting, credit bool) (Entry, error) {
	if p.Amount <= 0 {
		return Entry{}, ErrBadAmount
	}
	if p.Key == "" {
		return Entry{}, ErrNoKey
	}
	isCredit, err := p.Type.credit()
	if err != nil {
		return Entry{}, err
	}
	if isCredit != credit {
		return Entry{}, fmt.Errorf("%w: %s", ErrWrongDirection, p.Type)
	}
	signed := p.Amount
	if !credit {
		signed = -p.Amount
	}

	if err := Lock(ctx, tx, p.UserID); err != nil {
		return Entry{}, err
	}
	if prev, ok, err := byKey(ctx, tx, p.Key); err != nil {
		return Entry{}, err
	} else if ok {
		return replay(prev, p, signed)
	}
	if !credit {
		bal, err := Balance(ctx, tx, p.UserID)
		if err != nil {
			return Entry{}, err
		}
		if bal < p.Amount {
			return Entry{}, ErrInsufficientFunds
		}
	}

	e := Entry{UserID: p.UserID, Type: p.Type, Amount: signed, Description: p.Description, Key: p.Key, RefID: p.RefID}
	err = tx.QueryRow(ctx, `
		INSERT INTO ledger_entries (user_id, type, amount_microdollars, description, idempotency_key, ref_id)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::uuid)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id, created_at`,
		p.UserID, string(p.Type), signed, p.Description, p.Key, p.RefID).Scan(&e.ID, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Another user's transaction took the key between our check and insert.
		return Entry{}, ErrKeyReused
	}
	if err != nil {
		return Entry{}, fmt.Errorf("insert ledger entry: %w", err)
	}
	return e, nil
}

// replay returns the earlier entry for a key, if it is the same movement.
func replay(prev Entry, p Posting, signed int64) (Entry, error) {
	if prev.UserID != p.UserID || prev.Type != p.Type || prev.Amount != signed {
		return Entry{}, ErrKeyReused
	}
	prev.Replayed = true
	return prev, nil
}

const entryCols = `id, user_id, type, amount_microdollars, description, COALESCE(idempotency_key, ''), COALESCE(ref_id::text, ''), created_at`

func scanEntry(row pgx.Row) (Entry, error) {
	var e Entry
	var typ string
	err := row.Scan(&e.ID, &e.UserID, &typ, &e.Amount, &e.Description, &e.Key, &e.RefID, &e.CreatedAt)
	e.Type = Type(typ)
	return e, err
}

func byKey(ctx context.Context, q platform.Querier, key string) (Entry, bool, error) {
	e, err := scanEntry(q.QueryRow(ctx, `SELECT `+entryCols+` FROM ledger_entries WHERE idempotency_key = $1`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return Entry{}, false, nil
	}
	if err != nil {
		return Entry{}, false, fmt.Errorf("read ledger entry: %w", err)
	}
	return e, true, nil
}

// Cursor marks where the next page of activity starts.
type Cursor struct {
	At time.Time
	ID string
}

// Activity lists what the rep sees in their wallet, newest first: top-ups,
// calls, plan fees, number rent and refunds. Holds and releases are internal
// bookkeeping and are left out; Held reports money currently set aside.
// Pass a nil cursor for the first page. The returned cursor is nil when there
// are no more entries.
func Activity(ctx context.Context, q platform.Querier, userID string, after *Cursor, limit int) ([]Entry, *Cursor, error) {
	if limit <= 0 {
		limit = 50
	}
	args := []any{userID, limit + 1}
	where := ""
	if after != nil {
		where = `AND (created_at, id) < ($3, $4::uuid)`
		args = append(args, after.At, after.ID)
	}
	rows, err := q.Query(ctx, `
		SELECT `+entryCols+` FROM ledger_entries
		WHERE user_id = $1 AND type NOT IN ('hold', 'release') `+where+`
		ORDER BY created_at DESC, id DESC
		LIMIT $2`, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("list activity: %w", err)
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("scan activity: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("list activity: %w", err)
	}
	if len(out) <= limit {
		return out, nil, nil
	}
	out = out[:limit]
	last := out[len(out)-1]
	return out, &Cursor{At: last.CreatedAt, ID: last.ID}, nil
}
