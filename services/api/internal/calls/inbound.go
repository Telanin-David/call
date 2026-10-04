package calls

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/rates"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

// Incoming calls: a lead rings one of the rep's numbers back. On Starter
// and Pro, when the rep has the app open and isn't on another call, the
// call rings their browser phone and the app shows who it is; it is
// answered and billed like a call out, at the price of calling that
// number. Otherwise, or after InboundRingFor unanswered, it is a missed
// call and the lead goes to the top of Follow-ups. Callers who aren't on
// the rep's lists are logged in History only.
const (
	// RepOnlineWithin: a rep whose app checked in this recently is online.
	// The app checks every 2 seconds.
	RepOnlineWithin = 10 * time.Second
	// InboundRingFor is how long an incoming call rings the rep before it
	// becomes a missed call.
	InboundRingFor = 30 * time.Second
)

// Why an incoming call didn't ring the rep (its hangup cause).
const (
	missedUnknown   = "unknown_caller"
	missedPaused    = "account_paused"
	missedFree      = "free_plan"
	missedOffline   = "rep_offline"
	missedBusy      = "rep_on_a_call"
	missedNoRate    = "no_rate"
	missedLowFunds  = "low_balance"
	missedRingError = "ring_failed"
)

// incoming handles a call someone made to one of our numbers.
func (s *Service) incoming(ctx context.Context, ev telephony.CallEvent) error {
	if ev.CallControlID == "" {
		return nil
	}
	now := s.now()
	var numberID, userID string
	err := s.DB.QueryRow(ctx, `SELECT id, user_id FROM numbers WHERE number = $1 AND released_at IS NULL`, ev.To).Scan(&numberID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		s.log().WarnContext(ctx, "call to a number that isn't a rep's hung up", "to", ev.To)
		return s.Provider.Hangup(ctx, ev.CallControlID)
	}
	if err != nil {
		return fmt.Errorf("find number: %w", err)
	}

	var callID, state, missed string
	repeat := false
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		// One call start at a time per rep, as for calls out.
		if err := ledger.Lock(ctx, tx, userID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM calls WHERE telnyx_call_id = $1)`, ev.CallControlID).Scan(&repeat); err != nil {
			return fmt.Errorf("read call: %w", err)
		}
		if repeat {
			return nil
		}
		// The lead with this number the rep called most recently.
		var leadID *string
		err := tx.QueryRow(ctx, `
			SELECT l.id FROM leads l WHERE l.user_id = $1 AND l.phone = $2
			ORDER BY (SELECT max(c.started_at) FROM calls c WHERE c.lead_id = l.id) DESC NULLS LAST, l.created_at DESC LIMIT 1`,
			userID, ev.From).Scan(&leadID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("find caller: %w", err)
		}
		var price int64
		missed, price, err = canRing(ctx, tx, userID, leadID != nil, ev.From, now)
		if err != nil {
			return err
		}
		if missed != "" {
			if err := tx.QueryRow(ctx, `
				INSERT INTO calls (user_id, lead_id, from_number_id, to_number, direction, status, telnyx_call_id, started_at, ended_at, seconds, cost_microdollars, hangup_cause)
				VALUES ($1, $2, $3, $4, 'inbound', 'ended', $5, $6, $6, 0, 0, $7) RETURNING id`,
				userID, leadID, numberID, ev.From, ev.CallControlID, now, missed).Scan(&callID); err != nil {
				return fmt.Errorf("log missed call: %w", err)
			}
			if leadID != nil {
				return missedFollowup(ctx, tx, userID, *leadID, now)
			}
			return nil
		}
		if state, err = randomState(); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO calls (user_id, lead_id, from_number_id, to_number, direction, status, telnyx_call_id, price_per_min, started_at, client_state)
			VALUES ($1, $2, $3, $4, 'inbound', 'ringing', $5, $6, $7, $8) RETURNING id`,
			userID, leadID, numberID, ev.From, ev.CallControlID, price, now, state).Scan(&callID); err != nil {
			return fmt.Errorf("record incoming call: %w", err)
		}
		// Money for the first minute is held before it rings, as for a call out.
		hold, err := ledger.PlaceHold(ctx, tx, userID, callID, rates.HoldPerMinute(price), "call:"+callID+":hold")
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			missed = missedLowFunds
			if _, err := tx.Exec(ctx, `UPDATE calls SET status = 'ended', ended_at = $2, seconds = 0, cost_microdollars = 0, hangup_cause = $3 WHERE id = $1`,
				callID, now, missed); err != nil {
				return fmt.Errorf("log missed call: %w", err)
			}
			return missedFollowup(ctx, tx, userID, *leadID, now)
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE calls SET hold_id = $2 WHERE id = $1`, callID, hold.ID); err != nil {
			return fmt.Errorf("save hold: %w", err)
		}
		return nil
	})
	if err != nil || repeat {
		return err
	}
	if missed != "" {
		s.log().InfoContext(ctx, "missed call", "call_id", callID, "why", missed)
		return s.Provider.Hangup(ctx, ev.CallControlID)
	}
	cred, err := s.credential(ctx, userID)
	if err == nil {
		err = s.Provider.Ring(ctx, ev.CallControlID, cred, state)
	}
	if err != nil {
		s.log().ErrorContext(ctx, "ring the rep", "call_id", callID, "err", err)
		if herr := s.Provider.Hangup(ctx, ev.CallControlID); herr != nil {
			s.log().ErrorContext(ctx, "hang up", "call_id", callID, "err", herr)
		}
		return s.finish(ctx, callID, now, missedRingError)
	}
	return nil
}

// canRing says why an incoming call can't ring the rep ("" when it can),
// and the price per minute when it can.
func canRing(ctx context.Context, tx pgx.Tx, userID string, knownLead bool, caller string, now time.Time) (string, int64, error) {
	if !knownLead {
		return missedUnknown, 0, nil
	}
	var status string
	var seen *time.Time
	if err := tx.QueryRow(ctx, `SELECT status, seen_at FROM users WHERE id = $1`, userID).Scan(&status, &seen); err != nil {
		return "", 0, fmt.Errorf("read rep: %w", err)
	}
	if status == "suspended" {
		return missedPaused, 0, nil
	}
	planID := plans.Free
	if sub, ok, err := plans.Current(ctx, tx, userID); err != nil {
		return "", 0, err
	} else if ok {
		planID = sub.PlanID
	}
	if planID == plans.Free {
		return missedFree, 0, nil
	}
	if seen == nil || seen.Before(now.Add(-RepOnlineWithin)) {
		return missedOffline, 0, nil
	}
	var live bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM calls WHERE user_id = $1 AND status <> 'ended')`, userID).Scan(&live); err != nil {
		return "", 0, fmt.Errorf("read live calls: %w", err)
	}
	if live {
		return missedBusy, 0, nil
	}
	quote, err := rates.For(ctx, tx, planID, caller)
	if errors.Is(err, rates.ErrNoRate) {
		return missedNoRate, 0, nil
	}
	if err != nil {
		return "", 0, err
	}
	return "", quote.PricePerMin, nil
}

// missedFollowup puts the lead at the top of Follow-ups: an open follow-up
// for them moves to now, else a new one is made.
func missedFollowup(ctx context.Context, tx pgx.Tx, userID, leadID string, at time.Time) error {
	tag, err := tx.Exec(ctx, `UPDATE followups SET due_at = $3, kind = 'missed_call', reason = 'Missed call' WHERE user_id = $1 AND lead_id = $2 AND NOT done`,
		userID, leadID, at)
	if err != nil {
		return fmt.Errorf("move follow-up: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `INSERT INTO followups (user_id, lead_id, due_at, reason, kind, created_at) VALUES ($1, $2, $3, 'Missed call', 'missed_call', $3)`,
		userID, leadID, at); err != nil {
		return fmt.Errorf("add follow-up: %w", err)
	}
	return nil
}

// credential is the rep's provider login, made the first time.
func (s *Service) credential(ctx context.Context, userID string) (string, error) {
	var cred *string
	if err := s.DB.QueryRow(ctx, `SELECT telnyx_credential_id FROM users WHERE id = $1`, userID).Scan(&cred); err != nil {
		return "", fmt.Errorf("read credential: %w", err)
	}
	if cred != nil {
		return *cred, nil
	}
	_, id, err := s.loginAs(ctx, userID)
	return id, err
}

// IncomingCall is a call ringing the rep, with who is calling.
type IncomingCall struct {
	Call      Call
	RingUntil time.Time
	Lead      QueueLead
	Script    *QueueScript
}

// Ringing is the app checking for incoming calls. It counts as the rep
// being online, and returns the call ringing them, if any. A call that has
// rung too long is ended here as well as by the ticker.
func (s *Service) Ringing(ctx context.Context, userID string) (*IncomingCall, error) {
	now := s.now()
	if _, err := s.DB.Exec(ctx, `UPDATE users SET seen_at = $2 WHERE id = $1`, userID, now); err != nil {
		return nil, fmt.Errorf("check in: %w", err)
	}
	c, err := scanCall(s.DB.QueryRow(ctx, `SELECT `+callCols+callFrom+`WHERE c.user_id = $1 AND c.direction = 'inbound' AND c.status = 'ringing'`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read incoming call: %w", err)
	}
	if now.Sub(c.StartedAt) > InboundRingFor {
		if err := s.endNow(ctx, c, now, "ring_timeout"); err != nil {
			return nil, err
		}
		return nil, nil
	}
	in := &IncomingCall{Call: c, RingUntil: c.StartedAt.Add(InboundRingFor)}
	if c.LeadID == "" {
		return in, nil
	}
	q, err := s.Queue(ctx, userID, QueueFor{LeadID: c.LeadID})
	if err != nil {
		return nil, err
	}
	in.Lead = q.Leads[0]
	if len(q.Scripts) > 0 {
		in.Script = &q.Scripts[0]
	}
	// "Last call yesterday" and its note: the last call the rep saved a
	// result for, not missed calls in between.
	var last LastCall
	err = s.DB.QueryRow(ctx, `SELECT started_at, outcome, COALESCE(note, '') FROM calls WHERE lead_id = $1 AND id <> $2 AND outcome IS NOT NULL ORDER BY started_at DESC LIMIT 1`,
		c.LeadID, c.ID).Scan(&last.At, &last.Outcome, &last.Note)
	switch {
	case err == nil:
		in.Lead.LastCall = &last
	case errors.Is(err, pgx.ErrNoRows):
		in.Lead.LastCall = nil
	default:
		return nil, fmt.Errorf("read last call: %w", err)
	}
	return in, nil
}

// DevIncoming plays a call coming in from a number to the rep's default
// number, through the fake provider's signed events. It returns the call.
func (s *Service) DevIncoming(ctx context.Context, fake *telephony.FakeCalls, userID, from string) (Call, error) {
	var to string
	err := s.DB.QueryRow(ctx, `SELECT number FROM numbers WHERE user_id = $1 AND released_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1`, userID).Scan(&to)
	if errors.Is(err, pgx.ErrNoRows) {
		return Call{}, ErrNoNumber
	}
	if err != nil {
		return Call{}, fmt.Errorf("read number: %w", err)
	}
	id, err := randomState()
	if err != nil {
		return Call{}, err
	}
	ev := telephony.CallEvent{Type: telephony.EventInitiated, CallControlID: "fake-in-" + id, From: from, To: to, At: s.now(), Incoming: true}
	body, h := fake.Event(ev)
	parsed, err := fake.ParseEvent(h, body, s.now())
	if err != nil {
		return Call{}, err
	}
	if err := s.HandleEvent(ctx, parsed); err != nil {
		return Call{}, err
	}
	c, ok, err := s.find(ctx, telephony.CallEvent{CallControlID: ev.CallControlID})
	if err != nil {
		return Call{}, err
	}
	if !ok {
		return Call{}, ErrCallNotFound
	}
	return c, nil
}
