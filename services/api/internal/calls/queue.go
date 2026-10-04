package calls

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/rates"
	"github.com/telanin-david/call/services/api/internal/scripts"
)

// MaxQueue is the most leads one call screen loads.
const MaxQueue = 200

// QueueFor says which leads the call screen works through: one list, the
// follow-ups due today, or one lead. With none set it is the list Today
// offers.
type QueueFor struct {
	ListID    string
	Followups bool
	LeadID    string
}

// QueueLead is a lead as the call screen shows it.
type QueueLead struct {
	ID          string
	Name        string
	FirstName   string
	Company     string
	City        string
	Email       string
	Phone       string
	Notes       string
	HerTimeZone string
	Attempts    int
	ListName    string
	ScriptID    string
	LastCall    *LastCall
}

// LastCall is the lead's most recent call, for "Last call, 24 Sep".
type LastCall struct {
	At      time.Time
	Outcome string
	Note    string
}

// QueueScript is a script the queue's leads use.
type QueueScript struct {
	ID    string
	Name  string
	Parts []scripts.Part
}

// Queue is everything the call screen needs before the first dial.
type Queue struct {
	Title   string
	ListID  string
	Leads   []QueueLead
	Scripts []QueueScript
	// ScriptFreeUntil is the last day a Free rep sees the script on screen;
	// nil on a paid plan.
	ScriptFreeUntil *time.Time
	DialsToday      int
	DialLimit       *int
	Balance         int64
	// PricePerMin is the rep's price to the US and Canada.
	PricePerMin int64
	// LiveCallID is a call still open from before (a closed tab, say), so
	// the screen can end it.
	LiveCallID string
	// RecordCalls: answered calls are recorded, so the rep starts by
	// saying the call may be recorded.
	RecordCalls bool
}

const queueCols = `l.id, ` + leadName + `, l.first_name, l.company, l.city, l.email, l.phone, l.notes, l.attempts, ll.name, COALESCE(ll.script_id::text, ''),
	lc.started_at, COALESCE(lc.outcome, ''), COALESCE(lc.note, '')`

const queueFrom = ` FROM leads l JOIN lead_lists ll ON ll.id = l.list_id
	LEFT JOIN LATERAL (SELECT c.started_at, c.outcome, c.note FROM calls c WHERE c.lead_id = l.id ORDER BY c.started_at DESC LIMIT 1) lc ON true `

// callable is a lead the rules would still let the rep dial.
const callable = ` l.status IN ('new', 'called', 'callback', 'interested') AND l.attempts < $2
	AND NOT EXISTS (SELECT 1 FROM dnc_entries d WHERE d.user_id = l.user_id AND d.phone = l.phone) `

// Queue loads the call screen. The rules are checked again on each dial;
// this only leaves out leads that can't be called at all.
func (s *Service) Queue(ctx context.Context, userID string, f QueueFor) (Queue, error) {
	var q Queue
	var rows pgx.Rows
	var err error
	switch {
	case f.LeadID != "":
		if !uuidOK(f.LeadID) {
			return q, ErrLeadNotFound
		}
		rows, err = s.DB.Query(ctx, `SELECT `+queueCols+queueFrom+`WHERE l.id = $1 AND l.user_id = $2`, f.LeadID, userID)
	case f.Followups:
		q.Title = "Follow-ups due today"
		d, derr := s.repDay(ctx, userID, s.now())
		if derr != nil {
			return q, derr
		}
		rows, err = s.DB.Query(ctx, `
			SELECT `+queueCols+queueFrom+`
			JOIN LATERAL (SELECT min(due_at) AS due FROM followups fu WHERE fu.lead_id = l.id AND NOT fu.done) fu ON true
			WHERE l.user_id = $1 AND fu.due < $3 AND `+callable+`
			ORDER BY fu.due, l.id LIMIT $4`, userID, MaxTries, d.end, MaxQueue)
	default:
		listID := f.ListID
		if listID == "" {
			t, terr := s.Today(ctx, userID)
			if terr != nil {
				return q, terr
			}
			if t.Ready != nil {
				listID = t.Ready.ID
			}
		}
		if listID != "" {
			if !uuidOK(listID) {
				return q, ErrListNotFound
			}
			err = s.DB.QueryRow(ctx, `SELECT name FROM lead_lists WHERE id = $1 AND user_id = $2`, listID, userID).Scan(&q.Title)
			if errors.Is(err, pgx.ErrNoRows) {
				return q, ErrListNotFound
			}
			if err != nil {
				return q, fmt.Errorf("read list: %w", err)
			}
			q.ListID = listID
			// Never-called leads first, then the ones called longest ago.
			rows, err = s.DB.Query(ctx, `
				SELECT `+queueCols+queueFrom+`
				WHERE l.list_id = $3 AND l.user_id = $1 AND `+callable+`
				ORDER BY l.attempts, lc.started_at NULLS FIRST, l.created_at, l.phone LIMIT $4`, userID, MaxTries, listID, MaxQueue)
		}
	}
	if err != nil {
		return q, fmt.Errorf("read queue: %w", err)
	}
	if rows != nil {
		q.Leads, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (QueueLead, error) {
			var l QueueLead
			var at *time.Time
			var outcome, note string
			if err := r.Scan(&l.ID, &l.Name, &l.FirstName, &l.Company, &l.City, &l.Email, &l.Phone, &l.Notes, &l.Attempts, &l.ListName, &l.ScriptID,
				&at, &outcome, &note); err != nil {
				return l, err
			}
			l.HerTimeZone = herZone(l.Phone)
			if at != nil {
				l.LastCall = &LastCall{At: *at, Outcome: outcome, Note: note}
			}
			return l, nil
		})
		if err != nil {
			return q, fmt.Errorf("read queue: %w", err)
		}
	}
	if f.LeadID != "" {
		if len(q.Leads) == 0 {
			return q, ErrLeadNotFound
		}
		q.Title = q.Leads[0].ListName
	}
	if q.Leads == nil {
		q.Leads = []QueueLead{}
	}
	if err := s.queueScripts(ctx, userID, &q); err != nil {
		return q, err
	}
	if err := s.queueAccount(ctx, userID, &q); err != nil {
		return q, err
	}
	return q, nil
}

func (s *Service) queueScripts(ctx context.Context, userID string, q *Queue) error {
	ids := []string{}
	seen := map[string]bool{}
	for _, l := range q.Leads {
		if l.ScriptID != "" && !seen[l.ScriptID] {
			seen[l.ScriptID] = true
			ids = append(ids, l.ScriptID)
		}
	}
	q.Scripts = []QueueScript{}
	if len(ids) > 0 {
		rows, err := s.DB.Query(ctx, `SELECT id, name, parts FROM scripts WHERE user_id = $1 AND id::text = ANY($2) ORDER BY name`, userID, ids)
		if err != nil {
			return fmt.Errorf("read scripts: %w", err)
		}
		q.Scripts, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (QueueScript, error) {
			var sc QueueScript
			var parts []byte
			if err := r.Scan(&sc.ID, &sc.Name, &parts); err != nil {
				return sc, err
			}
			if err := json.Unmarshal(parts, &sc.Parts); err != nil {
				return sc, fmt.Errorf("script %s parts: %w", sc.ID, err)
			}
			return sc, nil
		})
		if err != nil {
			return fmt.Errorf("read scripts: %w", err)
		}
	}
	until, err := scripts.FreeUntil(ctx, s.DB, userID)
	if err != nil {
		return err
	}
	q.ScriptFreeUntil = until
	return nil
}

func (s *Service) queueAccount(ctx context.Context, userID string, q *Queue) error {
	now := s.now()
	d, err := s.repDay(ctx, userID, now)
	if err != nil {
		return err
	}
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM calls WHERE user_id = $1 AND direction = 'outbound' AND started_at >= $2`,
		userID, d.start).Scan(&q.DialsToday); err != nil {
		return fmt.Errorf("count today's calls: %w", err)
	}
	var verified bool
	var signedUp time.Time
	if err := s.DB.QueryRow(ctx, `
		SELECT created_at, EXISTS (SELECT 1 FROM verifications v WHERE v.user_id = u.id AND v.status = 'approved')
		FROM users u WHERE id = $1`, userID).Scan(&signedUp, &verified); err != nil {
		return fmt.Errorf("read rep: %w", err)
	}
	planID := plans.Free
	if sub, ok, err := plans.Current(ctx, s.DB, userID); err != nil {
		return err
	} else if ok {
		planID = sub.PlanID
	}
	if limit, ok := DailyLimit(planID, verified, signedUp, now); ok {
		q.DialLimit = &limit
	}
	if q.Balance, err = ledger.Balance(ctx, s.DB, userID); err != nil {
		return err
	}
	quote, err := rates.For(ctx, s.DB, planID, "1")
	if err != nil && !errors.Is(err, rates.ErrNoRate) {
		return err
	}
	q.PricePerMin = quote.PricePerMin
	if s.Recording {
		if q.RecordCalls, err = RecordsCalls(ctx, s.DB, userID); err != nil {
			return err
		}
	}
	// A call ringing in isn't one to end from here: the alert shows it.
	err = s.DB.QueryRow(ctx, `SELECT id FROM calls WHERE user_id = $1 AND status <> 'ended' AND NOT (direction = 'inbound' AND status = 'ringing')`,
		userID).Scan(&q.LiveCallID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("read live call: %w", err)
	}
	return nil
}
