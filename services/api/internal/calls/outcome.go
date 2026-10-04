package calls

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/leads"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Outcome is how a call went: the six choices on the call screen, keys 1 to 6.
type Outcome string

const (
	Interested    Outcome = "interested"
	CallBack      Outcome = "callback"
	NotInterested Outcome = "not_interested"
	NoAnswer      Outcome = "no_answer"
	WrongNumber   Outcome = "wrong_number"
	DoNotCall     Outcome = "do_not_call"
)

// leadStatus is where each outcome leaves the lead.
var leadStatus = map[Outcome]string{
	Interested: "interested", CallBack: "callback", NotInterested: "done",
	NoAnswer: "called", WrongNumber: "done", DoNotCall: "dnc",
}

// OutcomeInput is what the rep saves after a call.
type OutcomeInput struct {
	Outcome Outcome
	Note    string
	// FollowUpAt books a call back; optional for any outcome but do-not-call
	// and wrong number.
	FollowUpAt *time.Time
}

// SaveOutcome records how a call went, once it has ended. Saving again
// replaces the outcome and note (the 3-second Undo). Do not call puts the
// number on the rep's do-not-call list; a follow-up replaces any open one
// for the lead.
func (s *Service) SaveOutcome(ctx context.Context, userID, callID string, in OutcomeInput) (Call, error) {
	status, ok := leadStatus[in.Outcome]
	if !ok {
		return Call{}, ErrBadOutcome
	}
	in.Note = strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(in.Note) > 2000 {
		return Call{}, ErrNoteTooLong
	}
	now := s.now()
	if in.FollowUpAt != nil {
		if in.Outcome == DoNotCall || in.Outcome == WrongNumber || in.FollowUpAt.Before(now.Add(-time.Hour)) || in.FollowUpAt.After(now.AddDate(1, 0, 0)) {
			return Call{}, ErrBadFollowup
		}
	}
	c, err := s.Get(ctx, userID, callID)
	if err != nil {
		return Call{}, err
	}
	if c.Status != "ended" {
		return Call{}, ErrCallLive
	}
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE calls SET outcome = $2, note = NULLIF($3, ''), outcome_at = $4 WHERE id = $1`,
			c.ID, string(in.Outcome), in.Note, now); err != nil {
			return fmt.Errorf("save outcome: %w", err)
		}
		if c.LeadID == "" {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE leads SET status = $2 WHERE id = $1`, c.LeadID, status); err != nil {
			return fmt.Errorf("update lead: %w", err)
		}
		// A follow-up booked by an earlier save of this same call is
		// replaced; ones from before the call are done, since it happened.
		if _, err := tx.Exec(ctx, `DELETE FROM followups WHERE lead_id = $1 AND NOT done AND created_at >= $2`, c.LeadID, c.StartedAt); err != nil {
			return fmt.Errorf("replace follow-up: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE followups SET done = true WHERE lead_id = $1 AND NOT done`, c.LeadID); err != nil {
			return fmt.Errorf("close follow-ups: %w", err)
		}
		// Undo of "Do not call" takes the number back off the list.
		if Outcome(c.Outcome) == DoNotCall && in.Outcome != DoNotCall {
			if _, err := tx.Exec(ctx, `DELETE FROM dnc_entries WHERE user_id = $1 AND phone = $2 AND source = 'outcome'`, userID, c.To); err != nil {
				return fmt.Errorf("undo do-not-call: %w", err)
			}
		}
		if in.FollowUpAt != nil {
			reason := map[Outcome]string{Interested: "Interested", CallBack: "Asked for a call back"}[in.Outcome]
			if reason == "" {
				reason = "Call again"
			}
			if _, err := tx.Exec(ctx, `INSERT INTO followups (user_id, lead_id, due_at, reason, created_at) VALUES ($1, $2, $3, $4, $5)`,
				userID, c.LeadID, *in.FollowUpAt, reason, now); err != nil {
				return fmt.Errorf("book follow-up: %w", err)
			}
		}
		if in.Outcome == DoNotCall {
			return leads.AddDNC(ctx, tx, userID, c.To, "outcome")
		}
		return nil
	})
	if err != nil {
		return Call{}, err
	}
	return s.Get(ctx, userID, callID)
}
