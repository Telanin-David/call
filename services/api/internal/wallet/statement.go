package wallet

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/ledger"
)

// FormatUSD writes micro-dollars as dollars with no rounding: at least
// minDecimals places, more when the amount needs them ("-0.03125").
// Integers only; no floats touch money.
func FormatUSD(micro int64, minDecimals int) string {
	sign := ""
	if micro < 0 {
		sign = "-"
		micro = -micro
	}
	whole, frac := micro/1_000_000, micro%1_000_000
	f := strings.TrimRight(fmt.Sprintf("%06d", frac), "0")
	for len(f) < minDecimals {
		f += "0"
	}
	if f == "" {
		return sign + "$" + strconv.FormatInt(whole, 10)
	}
	return sign + "$" + strconv.FormatInt(whole, 10) + "." + f
}

// amountCell is FormatUSD without the dollar sign, for spreadsheets.
func amountCell(micro int64) string {
	return strings.Replace(FormatUSD(micro, 2), "$", "", 1)
}

// ParseMonth reads "2026-10". An empty month means the current one.
func ParseMonth(s string, now time.Time, loc *time.Location) (time.Time, time.Time, error) {
	if s == "" {
		from, to := monthBounds(now, loc)
		return from, to, nil
	}
	t, err := time.ParseInLocation("2006-01", s, loc)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("month: %w", err)
	}
	return t, t.AddDate(0, 1, 0), nil
}

// WriteStatement writes one month of activity as CSV, times in the rep's
// time zone, and a closing balance line.
func (s *Service) WriteStatement(ctx context.Context, w io.Writer, u auth.User, from, to time.Time) error {
	entries, err := ledger.Statement(ctx, s.DB, u.ID, from, to)
	if err != nil {
		return err
	}
	opening, err := balanceBefore(ctx, s, u.ID, from)
	if err != nil {
		return err
	}
	loc := location(u.Timezone)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"Date", "Type", "Description", "Amount (USD)", "Balance (USD)"})
	_ = cw.Write([]string{from.In(loc).Format("2006-01-02 15:04"), "", "Opening balance", "", amountCell(opening)})
	bal := opening
	for _, e := range entries {
		bal += e.Amount
		_ = cw.Write([]string{e.CreatedAt.In(loc).Format("2006-01-02 15:04"), typeLabel(e.Type), safeCell(e.Description), amountCell(e.Amount), amountCell(bal)})
	}
	cw.Flush()
	return cw.Error()
}

// balanceBefore is the balance at a moment from money actually moved. Holds
// are left out, like every statement line, so the lines add up.
func balanceBefore(ctx context.Context, s *Service, userID string, at time.Time) (int64, error) {
	var b int64
	err := s.DB.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_microdollars), 0)::BIGINT FROM ledger_entries
		WHERE user_id = $1 AND created_at < $2 AND type NOT IN ('hold', 'release')`, userID, at).Scan(&b)
	if err != nil {
		return 0, fmt.Errorf("opening balance: %w", err)
	}
	return b, nil
}

func typeLabel(t ledger.Type) string {
	switch t {
	case ledger.TypeTopUp:
		return "Top-up"
	case ledger.TypeCall:
		return "Call"
	case ledger.TypePlan:
		return "Plan"
	case ledger.TypeNumber:
		return "Number"
	case ledger.TypeRefund:
		return "Refund"
	}
	return string(t)
}

// safeCell stops a spreadsheet from running a description as a formula.
func safeCell(s string) string {
	if s != "" && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}
