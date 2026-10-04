package calls

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/rates"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

// Call is a call as stored.
type Call struct {
	ID           string
	UserID       string
	LeadID       string
	FromNumber   string
	To           string
	Status       string // dialing, ringing, answered, ended
	ProviderID   string
	PricePerMin  int64
	HoldID       string
	StartedAt    time.Time
	AnsweredAt   *time.Time
	EndedAt      *time.Time
	Seconds      int64
	Cost         int64
	LowBalanceAt *time.Time
	HangupCause  string
	Outcome      string
	Note         string
	ClientState  string
}

const callCols = `c.id, c.user_id, COALESCE(c.lead_id::text, ''), COALESCE(n.number, ''), c.to_number, c.status, COALESCE(c.telnyx_call_id, ''),
	c.price_per_min, COALESCE(c.hold_id::text, ''), c.started_at, c.answered_at, c.ended_at, COALESCE(c.seconds, 0), COALESCE(c.cost_microdollars, 0),
	c.low_balance_at, c.hangup_cause, COALESCE(c.outcome, ''), COALESCE(c.note, ''), COALESCE(c.client_state, '')`

const callFrom = ` FROM calls c LEFT JOIN numbers n ON n.id = c.from_number_id `

func scanCall(row pgx.Row) (Call, error) {
	var c Call
	err := row.Scan(&c.ID, &c.UserID, &c.LeadID, &c.FromNumber, &c.To, &c.Status, &c.ProviderID, &c.PricePerMin, &c.HoldID,
		&c.StartedAt, &c.AnsweredAt, &c.EndedAt, &c.Seconds, &c.Cost, &c.LowBalanceAt, &c.HangupCause, &c.Outcome, &c.Note, &c.ClientState)
	return c, err
}

// Get reads one of the rep's calls.
func (s *Service) Get(ctx context.Context, userID, callID string) (Call, error) {
	if !uuidOK(callID) {
		return Call{}, ErrCallNotFound
	}
	c, err := scanCall(s.DB.QueryRow(ctx, `SELECT `+callCols+callFrom+`WHERE c.id = $1 AND c.user_id = $2`, callID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Call{}, ErrCallNotFound
	}
	if err != nil {
		return Call{}, fmt.Errorf("read call: %w", err)
	}
	return c, nil
}

// HandleEvent moves a call along on a provider event that has already
// passed the signature check. Events can come twice or out of order; each
// step only moves forward.
func (s *Service) HandleEvent(ctx context.Context, ev telephony.CallEvent) error {
	c, ok, err := s.find(ctx, ev)
	if err != nil {
		return err
	}
	if !ok {
		// Not a call we started, or a guessed client state (someone trying
		// to bill their call to another rep): end it before it costs anything.
		if ev.Type == telephony.EventInitiated && ev.CallControlID != "" {
			s.log().WarnContext(ctx, "unknown call hung up", "call_control_id", ev.CallControlID, "to", ev.To)
			return s.Provider.Hangup(ctx, ev.CallControlID)
		}
		return nil
	}
	switch ev.Type {
	case telephony.EventInitiated:
		// The browser chose where to dial; only the number we checked may ring.
		if (ev.To != "" && ev.To != c.To) || (ev.From != "" && c.FromNumber != "" && ev.From != c.FromNumber) {
			s.log().WarnContext(ctx, "call to an unchecked number hung up", "call_id", c.ID, "to", ev.To, "want", c.To)
			if err := s.Provider.Hangup(ctx, ev.CallControlID); err != nil {
				return err
			}
			return s.finish(ctx, c.ID, ev.At, "wrong_number_dialled")
		}
		_, err := s.DB.Exec(ctx, `UPDATE calls SET telnyx_call_id = $2, status = 'ringing' WHERE id = $1 AND status = 'dialing'`, c.ID, ev.CallControlID)
		if err != nil {
			return fmt.Errorf("mark ringing: %w", err)
		}
	case telephony.EventAnswered:
		_, err := s.DB.Exec(ctx, `
			UPDATE calls SET status = 'answered', answered_at = $2, telnyx_call_id = COALESCE(telnyx_call_id, $3)
			WHERE id = $1 AND status IN ('dialing', 'ringing')`, c.ID, ev.At, nullable(ev.CallControlID))
		if err != nil {
			return fmt.Errorf("mark answered: %w", err)
		}
	case telephony.EventHangup:
		return s.finish(ctx, c.ID, ev.At, ev.HangupCause)
	}
	return nil
}

func (s *Service) find(ctx context.Context, ev telephony.CallEvent) (Call, bool, error) {
	var row pgx.Row
	switch {
	case ev.ClientState != "":
		row = s.DB.QueryRow(ctx, `SELECT `+callCols+callFrom+`WHERE c.client_state = $1`, ev.ClientState)
	case ev.CallControlID != "":
		row = s.DB.QueryRow(ctx, `SELECT `+callCols+callFrom+`WHERE c.telnyx_call_id = $1`, ev.CallControlID)
	default:
		return Call{}, false, nil
	}
	c, err := scanCall(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Call{}, false, nil
	}
	if err != nil {
		return Call{}, false, fmt.Errorf("find call: %w", err)
	}
	return c, true, nil
}

// finish ends a call and bills it: the exact seconds from answer to end at
// the price agreed before dialling, never more than was held. A call that
// was never answered costs nothing. Finishing twice is a no-op.
func (s *Service) finish(ctx context.Context, callID string, at time.Time, cause string) error {
	return platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var userID string
		if err := tx.QueryRow(ctx, `SELECT user_id FROM calls WHERE id = $1`, callID).Scan(&userID); err != nil {
			return fmt.Errorf("read call owner: %w", err)
		}
		if err := ledger.Lock(ctx, tx, userID); err != nil {
			return err
		}
		c, err := scanCall(tx.QueryRow(ctx, `SELECT `+callCols+callFrom+`WHERE c.id = $1 FOR UPDATE OF c`, callID))
		if err != nil {
			return fmt.Errorf("read call: %w", err)
		}
		if c.Status == "ended" {
			return nil
		}
		var seconds, cost int64
		if c.AnsweredAt != nil && at.After(*c.AnsweredAt) {
			seconds = int64(math.Ceil(at.Sub(*c.AnsweredAt).Seconds()))
			cost = rates.Charge(c.PricePerMin, seconds)
		}
		if c.HoldID != "" {
			h, err := ledger.GetHold(ctx, tx, c.HoldID)
			if err != nil {
				return err
			}
			if cost > h.Amount {
				// The minute ticker should never let this happen; if it does,
				// the rep pays what was held and we carry the rest.
				s.log().ErrorContext(ctx, "call cost more than its hold", "call_id", c.ID, "cost", cost, "held", h.Amount)
				cost = h.Amount
			}
			if cost > 0 {
				if _, err := ledger.Settle(ctx, tx, c.HoldID, cost, callLine(c.To, seconds)); err != nil {
					return err
				}
			} else if err := ledger.Release(ctx, tx, c.HoldID); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `
			UPDATE calls SET status = 'ended', ended_at = $2, seconds = $3, cost_microdollars = $4, hangup_cause = $5
			WHERE id = $1`, c.ID, at, seconds, cost, cause)
		if err != nil {
			return fmt.Errorf("end call: %w", err)
		}
		return nil
	})
}

// callLine is the ledger line for a call: "Call to +1 (646) 555-0110, 2:05".
func callLine(to string, seconds int64) string {
	pretty := to
	if len(to) == 12 && to[:2] == "+1" {
		pretty = fmt.Sprintf("+1 (%s) %s-%s", to[2:5], to[5:8], to[8:])
	}
	return fmt.Sprintf("Call to %s, %d:%02d", pretty, seconds/60, seconds%60)
}

// Hangup is the rep ending a call. The provider is told to hang up and the
// call is billed to now, so the screen shows the final time and cost at
// once; the provider's own hangup event that follows is a no-op.
func (s *Service) Hangup(ctx context.Context, userID, callID string) (Call, error) {
	c, err := s.Get(ctx, userID, callID)
	if err != nil {
		return Call{}, err
	}
	if c.Status != "ended" {
		cause := "rep_cancelled"
		if c.ProviderID != "" && s.Provider != nil {
			cause = "rep_hung_up"
			if err := s.Provider.Hangup(ctx, c.ProviderID); err != nil {
				s.log().ErrorContext(ctx, "hang up", "call_id", c.ID, "err", err)
				return Call{}, ErrUnavailable
			}
		}
		if err := s.finish(ctx, c.ID, s.now(), cause); err != nil {
			return Call{}, err
		}
	}
	return s.Get(ctx, userID, callID)
}

// TickResult counts what a tick did.
type TickResult struct {
	Extended int
	Warned   int
	Ended    int
}

// Tick keeps live calls paid for. Half a minute before the money held runs
// out it holds another minute; when the balance can't cover one, the call
// is marked low (the screen warns the rep) and ended when the hold runs
// out. It also ends calls that never connected or never reported an end.
// Every step is keyed, so ticks on two machines can't double a hold.
func (s *Service) Tick(ctx context.Context) (TickResult, error) {
	var res TickResult
	now := s.now()
	rows, err := s.DB.Query(ctx, `SELECT `+callCols+callFrom+`WHERE c.status <> 'ended'`)
	if err != nil {
		return res, fmt.Errorf("list live calls: %w", err)
	}
	live, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Call, error) { return scanCall(r) })
	if err != nil {
		return res, fmt.Errorf("list live calls: %w", err)
	}
	for _, c := range live {
		if err := s.tick(ctx, c, now, &res); err != nil {
			s.log().ErrorContext(ctx, "call tick failed", "call_id", c.ID, "err", err)
		}
	}
	if err := s.endLostPhones(ctx, now, &res); err != nil {
		s.log().ErrorContext(ctx, "lost phones", "err", err)
	}
	return res, nil
}

const (
	neverConnected = 2 * time.Minute // dialled, but the provider never heard of it
	neverAnswered  = 3 * time.Minute // ringing far longer than any phone rings
)

func (s *Service) tick(ctx context.Context, c Call, now time.Time, res *TickResult) error {
	switch c.Status {
	case "dialing":
		if now.Sub(c.StartedAt) > neverConnected {
			res.Ended++
			return s.finish(ctx, c.ID, now, "never_connected")
		}
		return nil
	case "ringing":
		if now.Sub(c.StartedAt) > neverAnswered {
			res.Ended++
			return s.endNow(ctx, c, now, "no_answer_timeout")
		}
		return nil
	}
	if c.AnsweredAt == nil || c.HoldID == "" || c.PricePerMin <= 0 {
		return nil
	}
	elapsed := now.Sub(*c.AnsweredAt)
	if elapsed > MaxCallLength {
		res.Ended++
		return s.endNow(ctx, c, now, "max_length")
	}
	h, err := ledger.GetHold(ctx, s.DB, c.HoldID)
	if err != nil {
		return err
	}
	covered := time.Duration(h.Amount/c.PricePerMin) * time.Minute
	if elapsed < covered-WarnBefore {
		return nil
	}
	minute := int(h.Amount/c.PricePerMin) + 1
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		_, err := ledger.ExtendHold(ctx, tx, c.HoldID, c.PricePerMin, fmt.Sprintf("call:%s:minute:%d", c.ID, minute))
		return err
	})
	switch {
	case err == nil:
		res.Extended++
		if c.LowBalanceAt != nil {
			_, err := s.DB.Exec(ctx, `UPDATE calls SET low_balance_at = NULL WHERE id = $1`, c.ID)
			return err
		}
		return nil
	case errors.Is(err, ledger.ErrInsufficientFunds):
		if c.LowBalanceAt == nil {
			res.Warned++
			if _, err := s.DB.Exec(ctx, `UPDATE calls SET low_balance_at = $2 WHERE id = $1`, c.ID, now); err != nil {
				return fmt.Errorf("mark low balance: %w", err)
			}
		}
		if elapsed >= covered {
			res.Ended++
			// Bill up to the moment the money ran out; the few seconds until
			// this tick are on us.
			return s.endNow(ctx, c, c.AnsweredAt.Add(covered), "balance_ran_out")
		}
		return nil
	default:
		return err
	}
}

// endNow hangs up at the provider and bills the call at now, without
// waiting for the hangup event (which then finds it ended).
func (s *Service) endNow(ctx context.Context, c Call, now time.Time, cause string) error {
	if c.ProviderID != "" && s.Provider != nil {
		if err := s.Provider.Hangup(ctx, c.ProviderID); err != nil {
			return err
		}
	}
	return s.finish(ctx, c.ID, now, cause)
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
