package ledger

import (
	"context"
	"fmt"
	"time"

	"github.com/telanin-david/call/services/api/internal/platform"
)

// Spent totals what went out since a moment, by type: calls, plan fees,
// number rent. Holds are left out (they are not spending yet) and so are
// refunds of spending, which come in as credits.
func Spent(ctx context.Context, q platform.Querier, userID string, since time.Time) (map[Type]int64, error) {
	rows, err := q.Query(ctx, `
		SELECT type, -SUM(amount_microdollars)::BIGINT FROM ledger_entries
		WHERE user_id = $1 AND created_at >= $2 AND type IN ('call', 'plan', 'number')
		GROUP BY type`, userID, since)
	if err != nil {
		return nil, fmt.Errorf("sum spending: %w", err)
	}
	defer rows.Close()
	out := map[Type]int64{}
	for rows.Next() {
		var t string
		var n int64
		if err := rows.Scan(&t, &n); err != nil {
			return nil, fmt.Errorf("scan spending: %w", err)
		}
		out[Type(t)] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sum spending: %w", err)
	}
	return out, nil
}

// Statement lists every entry the rep sees, oldest first, in [from, to).
func Statement(ctx context.Context, q platform.Querier, userID string, from, to time.Time) ([]Entry, error) {
	rows, err := q.Query(ctx, `
		SELECT `+entryCols+` FROM ledger_entries
		WHERE user_id = $1 AND created_at >= $2 AND created_at < $3 AND type NOT IN ('hold', 'release')
		ORDER BY created_at, id`, userID, from, to)
	if err != nil {
		return nil, fmt.Errorf("list statement: %w", err)
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("scan statement: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list statement: %w", err)
	}
	return out, nil
}
