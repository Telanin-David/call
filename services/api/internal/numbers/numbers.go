// Package numbers rents US and Canada phone numbers to reps: search by area
// code, rent, pick a default, cancel, and renew each month from the
// balance. Talking to the provider goes through telephony.Numbers.
//
// Renting never holds a database lock while the provider is asked: the
// balance is checked, the number is ordered, then the first month is
// charged. If that charge fails (the money was spent meanwhile), the number
// is given straight back, so nobody keeps a number they didn't pay for.
package numbers

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/phone"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

const (
	// Cost is what the provider charges us for a US or Canada local number
	// each month: $1.00 on Telnyx's list (plan section 11). Numbers that cost
	// more are not offered.
	Cost int64 = 1_000_000
	// MaxNumbers a rep can rent at once, so a stolen card can't buy hundreds.
	MaxNumbers = 20
	// GraceDays a rep has to top up after a renewal can't be paid, before
	// the number is released: the same as plans (open decision 4).
	GraceDays = 3

	searchLimit     = 10
	searchesPerHour = 120
	microPerCent    = 10_000
)

// Price is what a rep pays each month for a number: the provider's price
// × 1.5, the same on every plan (plan section 1). $1.50 today.
func Price() int64 { return Cost * 3 / 2 }

// Service rents numbers.
type Service struct {
	DB *pgxpool.Pool
	// Provider is nil when no phone provider is set up: numbers can be
	// listed but not searched or rented.
	Provider telephony.Numbers
	Mail     notify.Mailer
	Limiter  platform.Limiter
	Log      *slog.Logger
}

func (s *Service) log() *slog.Logger {
	if s.Log == nil {
		return slog.Default()
	}
	return s.Log
}

// Error is a failure the rep can act on. Message is shown on screen as is.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return "numbers: " + e.Code }

var (
	ErrBadCountry   = &Error{http.StatusUnprocessableEntity, "invalid_country", "Pick the United States or Canada."}
	ErrBadAreaCode  = &Error{http.StatusUnprocessableEntity, "invalid_area_code", "Type a 3-digit area code, like 646."}
	ErrNotForSale   = &Error{http.StatusUnprocessableEntity, "not_for_sale", "That number can't be rented here. Pick one from the list."}
	ErrTooMany      = &Error{http.StatusUnprocessableEntity, "too_many_numbers", fmt.Sprintf("You can have up to %d numbers. Cancel one you don't use first.", MaxNumbers)}
	ErrLowBalance   = &Error{http.StatusPaymentRequired, "low_balance", "Your balance is too low for this. Add money and try again."}
	ErrNumberGone   = &Error{http.StatusConflict, "number_gone", "Someone just took that number. Pick another one."}
	ErrNotFound     = &Error{http.StatusNotFound, "number_not_found", "That number isn't one of yours."}
	ErrUnavailable  = &Error{http.StatusServiceUnavailable, "numbers_unavailable", "Numbers can't be rented right now. Try again in a few minutes."}
	ErrTooManyTries = &Error{http.StatusTooManyRequests, "too_many", "Too many searches. Wait a few minutes and try again."}

	areaCodeRE = regexp.MustCompile(`^[2-9][0-9]{2}$`)
	uuidRE     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// Available is a number a rep can rent.
type Available struct {
	E164 string
	City string
}

// Number is one of a rep's rented numbers.
type Number struct {
	ID              string
	E164            string
	City            string
	Country         string
	Default         bool
	MonthlyPrice    int64
	RenewsOn        time.Time
	CancelOn        *time.Time
	RenewalFailedAt *time.Time
	CreatedAt       time.Time
}

// Pretty writes +16465550142 as "+1 (646) 555-0142".
func Pretty(e164 string) string {
	if len(e164) != 12 || !strings.HasPrefix(e164, "+1") {
		return e164
	}
	return fmt.Sprintf("+1 (%s) %s-%s", e164[2:5], e164[5:8], e164[8:])
}

// Search lists numbers for rent in an area code.
func (s *Service) Search(ctx context.Context, userID, country, areaCode string) ([]Available, error) {
	country = strings.ToUpper(strings.TrimSpace(country))
	if country != "US" && country != "CA" {
		return nil, ErrBadCountry
	}
	areaCode = strings.TrimSpace(areaCode)
	if !areaCodeRE.MatchString(areaCode) || (areaCode[1] == '1' && areaCode[2] == '1') {
		return nil, ErrBadAreaCode
	}
	if s.Provider == nil {
		return nil, ErrUnavailable
	}
	if s.Limiter != nil {
		ok, err := s.Limiter.Allow(ctx, "numbers:search:"+userID, searchesPerHour, time.Hour)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrTooManyTries
		}
	}
	found, err := s.Provider.Search(ctx, country, areaCode, searchLimit)
	if err != nil {
		s.log().ErrorContext(ctx, "number search failed", "area_code", areaCode, "err", err)
		return nil, ErrUnavailable
	}
	var e164s []string
	for _, a := range found {
		e164s = append(e164s, a.E164)
	}
	taken, err := live(ctx, s.DB, e164s)
	if err != nil {
		return nil, err
	}
	out := []Available{}
	for _, a := range found {
		if a.MonthlyCost > Cost || !rentable(a.E164) || taken[a.E164] {
			continue
		}
		out = append(out, Available{E164: a.E164, City: a.City})
	}
	return out, nil
}

// rentable is a US or Canada number that isn't premium-rate.
func rentable(e164 string) bool {
	p, err := phone.Parse(e164)
	return err == nil && p == e164 && phone.RegionOf(p) == phone.USCA && !phone.Premium(p)
}

// live reports which numbers are already rented by any rep.
func live(ctx context.Context, q platform.Querier, e164s []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(e164s) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT number FROM numbers WHERE released_at IS NULL AND number = ANY($1)`, e164s)
	if err != nil {
		return nil, fmt.Errorf("read rented numbers: %w", err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("read rented numbers: %w", err)
	}
	for _, n := range got {
		out[n] = true
	}
	return out, nil
}

// RentInput is what a rep picked from Search.
type RentInput struct {
	E164    string
	City    string // shown to the rep only
	Country string
}

// Rent buys a number and charges its first month.
func (s *Service) Rent(ctx context.Context, userID string, in RentInput) (Number, error) {
	in.Country = strings.ToUpper(strings.TrimSpace(in.Country))
	if in.Country != "US" && in.Country != "CA" {
		return Number{}, ErrBadCountry
	}
	if !rentable(in.E164) {
		return Number{}, ErrNotForSale
	}
	in.City = strings.Join(strings.Fields(in.City), " ")
	if utf8.RuneCountInString(in.City) > 60 {
		in.City = string([]rune(in.City)[:60])
	}
	if s.Provider == nil {
		return Number{}, ErrUnavailable
	}

	// Cheap checks first, so the provider is only asked when renting can work.
	var count int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM numbers WHERE user_id = $1 AND released_at IS NULL`, userID).Scan(&count); err != nil {
		return Number{}, fmt.Errorf("count numbers: %w", err)
	}
	if count >= MaxNumbers {
		return Number{}, ErrTooMany
	}
	bal, err := ledger.Balance(ctx, s.DB, userID)
	if err != nil {
		return Number{}, err
	}
	if bal < Price() {
		return Number{}, ErrLowBalance
	}
	if taken, err := live(ctx, s.DB, []string{in.E164}); err != nil {
		return Number{}, err
	} else if taken[in.E164] {
		return Number{}, ErrNumberGone
	}

	ord, err := s.Provider.Order(ctx, in.E164)
	if errors.Is(err, telephony.ErrNumberGone) {
		return Number{}, ErrNumberGone
	}
	if err != nil {
		s.log().ErrorContext(ctx, "number order failed", "number", in.E164, "err", err)
		return Number{}, ErrUnavailable
	}

	var id string
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		if err := ledger.Lock(ctx, tx, userID); err != nil {
			return err
		}
		today := platform.ToDate(time.Now())
		err := tx.QueryRow(ctx, `
			INSERT INTO numbers (user_id, number, city, country, provider_id, monthly_cost, monthly_price, is_default, renews_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7,
				NOT EXISTS (SELECT 1 FROM numbers WHERE user_id = $1 AND is_default AND released_at IS NULL), $8)
			RETURNING id`,
			userID, in.E164, in.City, in.Country, ord.ProviderID, Cost, Price(), platform.AddMonths(today, 1, today.Day())).Scan(&id)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrNumberGone
		}
		if err != nil {
			return fmt.Errorf("insert number: %w", err)
		}
		_, err = ledger.Debit(ctx, tx, ledger.Posting{
			UserID: userID, Type: ledger.TypeNumber, Amount: Price(), RefID: id,
			Description: fmt.Sprintf("Number %s, first month", Pretty(in.E164)),
			Key:         "number:" + id + ":rent",
		})
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return ErrLowBalance
		}
		return err
	})
	if errors.Is(err, ErrNumberGone) {
		// Another rep has it on our account: it is theirs, so keep it.
		return Number{}, err
	}
	if err != nil {
		// Give the number back: the rep didn't pay for it.
		if rerr := s.Provider.Release(context.WithoutCancel(ctx), in.E164); rerr != nil {
			s.log().ErrorContext(ctx, "release after failed rent", "number", in.E164, "err", rerr)
		}
		return Number{}, err
	}
	return s.get(ctx, userID, id)
}

const numberCols = `id, number, city, country, is_default, monthly_price, renews_at, cancel_on, renewal_failed_at, created_at`

func scanNumber(row pgx.Row) (Number, error) {
	var n Number
	err := row.Scan(&n.ID, &n.E164, &n.City, &n.Country, &n.Default, &n.MonthlyPrice, &n.RenewsOn, &n.CancelOn, &n.RenewalFailedAt, &n.CreatedAt)
	return n, err
}

// List returns the rep's numbers, the default first.
func (s *Service) List(ctx context.Context, userID string) ([]Number, error) {
	rows, err := s.DB.Query(ctx, `SELECT `+numberCols+` FROM numbers WHERE user_id = $1 AND released_at IS NULL
		ORDER BY is_default DESC, created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("list numbers: %w", err)
	}
	defer rows.Close()
	out := []Number{}
	for rows.Next() {
		n, err := scanNumber(rows)
		if err != nil {
			return nil, fmt.Errorf("scan number: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Service) get(ctx context.Context, userID, id string) (Number, error) {
	if !uuidRE.MatchString(id) {
		return Number{}, ErrNotFound
	}
	n, err := scanNumber(s.DB.QueryRow(ctx, `SELECT `+numberCols+` FROM numbers WHERE id = $1 AND user_id = $2 AND released_at IS NULL`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Number{}, ErrNotFound
	}
	if err != nil {
		return Number{}, fmt.Errorf("read number: %w", err)
	}
	return n, nil
}

// SetDefault makes a number the one calls go out from when no closer one fits.
func (s *Service) SetDefault(ctx context.Context, userID, id string) (Number, error) {
	if _, err := s.get(ctx, userID, id); err != nil {
		return Number{}, err
	}
	err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE numbers SET is_default = false WHERE user_id = $1 AND is_default AND id <> $2`, userID, id); err != nil {
			return fmt.Errorf("clear default: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE numbers SET is_default = true WHERE id = $1 AND user_id = $2 AND released_at IS NULL`, id, userID); err != nil {
			return fmt.Errorf("set default: %w", err)
		}
		return nil
	})
	if err != nil {
		return Number{}, err
	}
	return s.get(ctx, userID, id)
}

// Cancel stops a number renewing. The rep keeps it until the end of the
// month already paid for.
func (s *Service) Cancel(ctx context.Context, userID, id string) (Number, error) {
	return s.setCancel(ctx, userID, id, true)
}

// Keep undoes Cancel before the number is released.
func (s *Service) Keep(ctx context.Context, userID, id string) (Number, error) {
	return s.setCancel(ctx, userID, id, false)
}

func (s *Service) setCancel(ctx context.Context, userID, id string, cancel bool) (Number, error) {
	if !uuidRE.MatchString(id) {
		return Number{}, ErrNotFound
	}
	tag, err := s.DB.Exec(ctx, `
		UPDATE numbers SET cancel_on = CASE WHEN $3 THEN renews_at END
		WHERE id = $1 AND user_id = $2 AND released_at IS NULL`, id, userID, cancel)
	if err != nil {
		return Number{}, fmt.Errorf("cancel number: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return Number{}, ErrNotFound
	}
	return s.get(ctx, userID, id)
}

func dollars(micro int64) string {
	cents := (micro + microPerCent/2) / microPerCent
	return fmt.Sprintf("$%d.%02d", cents/100, cents%100)
}

func firstName(name string) string {
	first, _, _ := strings.Cut(strings.TrimSpace(name), " ")
	return first
}
