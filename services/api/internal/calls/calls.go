// Package calls runs a call from start to bill. Before every dial it checks
// the rules on the server (daily limit, 3 tries per number, do-not-call,
// premium numbers, calling hours, the cap abroad, a number to call from,
// and money for the first minute), holds that first minute, and hands the
// browser a phone login. The provider's signed events then move the call
// along; the minute ticker tops the hold up while the call runs; and at
// the end the rep pays for the exact seconds, never more than was held.
package calls

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/phone"
	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/rates"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

// Service runs calls.
type Service struct {
	DB *pgxpool.Pool
	// Provider is nil when no phone provider is set up: calling is off.
	Provider telephony.Calls
	Log      *slog.Logger
	// Now is the clock; tests set it.
	Now func() time.Time
}

func (s *Service) log() *slog.Logger {
	if s.Log == nil {
		return slog.Default()
	}
	return s.Log
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Lead is who is being called.
type Lead struct {
	ID        string
	FirstName string
	LastName  string
	Company   string
	Phone     string
	City      string
}

// Name is how the rep sees the lead: "Lena Park", else the company.
func (l Lead) Name() string {
	if n := strings.TrimSpace(l.FirstName + " " + l.LastName); n != "" {
		return n
	}
	if l.Company != "" {
		return l.Company
	}
	return "this lead"
}

// Started is a call that passed every check and may be dialled.
type Started struct {
	CallID      string
	Lead        Lead
	From        string // E.164 of the rep's number the lead will see
	To          string
	PricePerMin int64
	Held        int64
	// Token signs the browser phone in for this call.
	Token string
	// ClientState goes with the call to the provider and comes back on its
	// events. Only this browser knows it.
	ClientState string
	// HerTimeZone is the lead's time zone, for "their time" on screen.
	HerTimeZone string
}

// Start checks every rule for calling leadID now, holds the first minute
// and records the call. It returns a Blocked error when a rule says no.
func (s *Service) Start(ctx context.Context, u auth.User, leadID string) (Started, error) {
	if !uuidOK(leadID) {
		return Started{}, ErrLeadNotFound
	}
	if s.Provider == nil {
		return Started{}, ErrUnavailable
	}
	now := s.now()
	var st Started
	err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		// One money movement or call start at a time per rep.
		if err := ledger.Lock(ctx, tx, u.ID); err != nil {
			return err
		}
		var status string
		var verified bool
		var signedUp time.Time
		var tz string
		err := tx.QueryRow(ctx, `
			SELECT status, created_at, timezone,
				EXISTS (SELECT 1 FROM verifications v WHERE v.user_id = u.id AND v.status = 'approved')
			FROM users u WHERE id = $1`, u.ID).Scan(&status, &signedUp, &tz, &verified)
		if err != nil {
			return fmt.Errorf("read rep: %w", err)
		}
		if status == "suspended" {
			return ErrSuspended
		}
		var live bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM calls WHERE user_id = $1 AND status <> 'ended')`, u.ID).Scan(&live); err != nil {
			return fmt.Errorf("read live calls: %w", err)
		}
		if live {
			return ErrOnACall
		}

		var l Lead
		err = tx.QueryRow(ctx, `SELECT id, first_name, last_name, company, phone, city FROM leads WHERE id = $1 AND user_id = $2 FOR UPDATE`,
			leadID, u.ID).Scan(&l.ID, &l.FirstName, &l.LastName, &l.Company, &l.Phone, &l.City)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLeadNotFound
		}
		if err != nil {
			return fmt.Errorf("read lead: %w", err)
		}
		name := l.Name()

		// Free reasons first: a skipped lead never costs anything.
		var dnc bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM dnc_entries WHERE user_id = $1 AND phone = $2)`, u.ID, l.Phone).Scan(&dnc); err != nil {
			return fmt.Errorf("read do-not-call: %w", err)
		}
		if dnc {
			return doNotCall(name)
		}
		if phone.Premium(l.Phone) {
			return premium(name)
		}
		var tries int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM calls WHERE user_id = $1 AND to_number = $2 AND direction = 'outbound'`, u.ID, l.Phone).Scan(&tries); err != nil {
			return fmt.Errorf("count tries: %w", err)
		}
		if tries >= MaxTries {
			return threeTries(name)
		}
		zones := phone.TimeZones(l.Phone)
		if !phone.InCallingHours(l.Phone, now) {
			return outsideHours(name, herTime(outOfHours(zones, now), now))
		}

		planID := plans.Free
		if sub, ok, err := plans.Current(ctx, tx, u.ID); err != nil {
			return err
		} else if ok {
			planID = sub.PlanID
		}
		if limit, ok := DailyLimit(planID, verified, signedUp, now); ok {
			var today int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM calls WHERE user_id = $1 AND direction = 'outbound' AND started_at >= $2`,
				u.ID, startOfDay(now, tz)).Scan(&today); err != nil {
				return fmt.Errorf("count today's calls: %w", err)
			}
			if today >= limit {
				return dailyLimit(limit, planID, verified)
			}
		}

		quote, err := rates.For(ctx, tx, planID, l.Phone)
		if errors.Is(err, rates.ErrNoRate) {
			return noRate(name)
		}
		if err != nil {
			return err
		}
		if phone.RegionOf(l.Phone) == phone.Abroad && !verified {
			spent, err := spentAbroad(ctx, tx, u.ID, startOfDay(now, tz))
			if err != nil {
				return err
			}
			if spent+quote.Hold() > AbroadPerDay {
				return abroadCap()
			}
		}

		from, err := pickNumber(ctx, tx, u.ID, l.Phone)
		if err != nil {
			return err
		}

		state, err := randomState()
		if err != nil {
			return err
		}
		var callID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO calls (user_id, lead_id, from_number_id, to_number, price_per_min, started_at, client_state)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
			u.ID, l.ID, from.id, l.Phone, quote.PricePerMin, now, state).Scan(&callID); err != nil {
			return fmt.Errorf("insert call: %w", err)
		}
		hold, err := ledger.PlaceHold(ctx, tx, u.ID, callID, quote.Hold(), "call:"+callID+":hold")
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			bal, berr := ledger.Balance(ctx, tx, u.ID)
			if berr != nil {
				return berr
			}
			return lowBalance(bal)
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE calls SET hold_id = $2 WHERE id = $1`, callID, hold.ID); err != nil {
			return fmt.Errorf("save hold: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE leads SET attempts = attempts + 1, status = CASE WHEN status = 'new' THEN 'called' ELSE status END WHERE id = $1`, l.ID); err != nil {
			return fmt.Errorf("count attempt: %w", err)
		}
		st = Started{CallID: callID, Lead: l, From: from.e164, To: l.Phone, PricePerMin: quote.PricePerMin, Held: hold.Amount, ClientState: state}
		if len(zones) > 0 {
			st.HerTimeZone = zones[0]
		}
		return nil
	})
	if err != nil {
		return Started{}, err
	}

	token, err := s.login(ctx, u.ID)
	if err != nil {
		s.log().ErrorContext(ctx, "phone login failed", "user_id", u.ID, "err", err)
		if ferr := s.finish(ctx, st.CallID, s.now(), "login_failed"); ferr != nil {
			s.log().ErrorContext(ctx, "cancel call", "call_id", st.CallID, "err", ferr)
		}
		return Started{}, ErrUnavailable
	}
	st.Token = token
	return st, nil
}

// login gets a browser-phone token, making the rep's provider login the
// first time.
func (s *Service) login(ctx context.Context, userID string) (string, error) {
	var cred *string
	if err := s.DB.QueryRow(ctx, `SELECT telnyx_credential_id FROM users WHERE id = $1`, userID).Scan(&cred); err != nil {
		return "", fmt.Errorf("read credential: %w", err)
	}
	have := ""
	if cred != nil {
		have = *cred
	}
	token, id, err := s.Provider.Login(ctx, userID, have)
	if err != nil {
		return "", err
	}
	if id != have {
		if _, err := s.DB.Exec(ctx, `UPDATE users SET telnyx_credential_id = $2 WHERE id = $1`, userID, id); err != nil {
			return "", fmt.Errorf("save credential: %w", err)
		}
	}
	return token, nil
}

type fromNumber struct{ id, e164 string }

// pickNumber is the rep's number in the lead's area code, else one in the
// lead's time zone, else the default (open decision 8: closest number).
func pickNumber(ctx context.Context, tx pgx.Tx, userID, to string) (fromNumber, error) {
	rows, err := tx.Query(ctx, `SELECT id, number, is_default FROM numbers WHERE user_id = $1 AND released_at IS NULL ORDER BY is_default DESC, created_at`, userID)
	if err != nil {
		return fromNumber{}, fmt.Errorf("read numbers: %w", err)
	}
	type row struct {
		n   fromNumber
		def bool
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.n.id, &r.n.e164, &r.def); err != nil {
			rows.Close()
			return fromNumber{}, fmt.Errorf("scan number: %w", err)
		}
		all = append(all, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fromNumber{}, fmt.Errorf("read numbers: %w", err)
	}
	if len(all) == 0 {
		return fromNumber{}, ErrNoNumber
	}
	if len(to) == 12 && strings.HasPrefix(to, "+1") {
		for _, r := range all {
			if r.n.e164[:5] == to[:5] {
				return r.n, nil
			}
		}
		if zs := phone.TimeZones(to); len(zs) > 0 {
			for _, r := range all {
				if nz := phone.TimeZones(r.n.e164); len(nz) > 0 && nz[0] == zs[0] {
					return r.n, nil
				}
			}
		}
	}
	return all[0].n, nil // the default is listed first
}

// startOfDay is midnight today in the rep's time zone ("calling opens again
// at midnight, your time").
func startOfDay(now time.Time, tz string) time.Time {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	t := now.In(loc)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
}

// outOfHours puts the zones where it's too early or late first, so the
// message shows the time that blocked the call.
func outOfHours(zones []string, now time.Time) []string {
	for i, z := range zones {
		if loc, err := time.LoadLocation(z); err == nil {
			if h := now.In(loc).Hour(); h < phone.FirstHour || h >= phone.LastHour {
				return append([]string{z}, append(append([]string{}, zones[:i]...), zones[i+1:]...)...)
			}
		}
	}
	return zones
}

// herTime is "10:14 pm" in the lead's first time zone.
func herTime(zones []string, now time.Time) string {
	if len(zones) == 0 {
		return ""
	}
	loc, err := time.LoadLocation(zones[0])
	if err != nil {
		return ""
	}
	return strings.ToLower(now.In(loc).Format("3:04 PM"))
}

// spentAbroad is what calls outside the US and Canada mainland have cost
// the rep since the start of their day.
func spentAbroad(ctx context.Context, tx pgx.Tx, userID string, since time.Time) (int64, error) {
	rows, err := tx.Query(ctx, `SELECT to_number, COALESCE(cost_microdollars, 0) FROM calls WHERE user_id = $1 AND started_at >= $2`, userID, since)
	if err != nil {
		return 0, fmt.Errorf("read today's calls: %w", err)
	}
	defer rows.Close()
	var total int64
	for rows.Next() {
		var to string
		var cost int64
		if err := rows.Scan(&to, &cost); err != nil {
			return 0, fmt.Errorf("scan call: %w", err)
		}
		if phone.RegionOf(to) == phone.Abroad {
			total += cost
		}
	}
	return total, rows.Err()
}

// randomState is 128 random bits, URL-safe.
func randomState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func uuidOK(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if (r < '0' || r > '9') && (r < 'a' || r > 'f') && (r < 'A' || r > 'F') {
				return false
			}
		}
	}
	return true
}
