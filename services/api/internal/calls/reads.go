package calls

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/phone"
	"github.com/telanin-david/call/services/api/internal/plans"
)

// LeadRef is a lead as lists show it.
type LeadRef struct {
	ID          string
	Name        string
	Company     string
	Phone       string
	HerTimeZone string
}

const leadName = `COALESCE(NULLIF(trim(l.first_name || ' ' || l.last_name), ''), NULLIF(l.company, ''), l.phone)`

func herZone(e164 string) string {
	if zs := phone.TimeZones(e164); len(zs) > 0 {
		return zs[0]
	}
	return ""
}

// day is the rep's calendar day around now, in their time zone.
type day struct{ start, end time.Time }

func (s *Service) repDay(ctx context.Context, userID string, now time.Time) (day, error) {
	var tz string
	if err := s.DB.QueryRow(ctx, `SELECT timezone FROM users WHERE id = $1`, userID).Scan(&tz); err != nil {
		return day{}, fmt.Errorf("read time zone: %w", err)
	}
	start := startOfDay(now, tz)
	return day{start, start.AddDate(0, 0, 1)}, nil
}

// Totals add up calls over a time span. Calls counts calls out (dials);
// talk time and money include calls answered from leads calling back.
type Totals struct {
	Calls       int
	TalkSeconds int64
	Spent       int64
	Interested  int
}

func (s *Service) totals(ctx context.Context, userID string, from, to time.Time) (Totals, error) {
	var t Totals
	err := s.DB.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE direction = 'outbound'), COALESCE(SUM(seconds), 0)::BIGINT, COALESCE(SUM(cost_microdollars), 0)::BIGINT,
			count(*) FILTER (WHERE outcome = 'interested')
		FROM calls WHERE user_id = $1 AND started_at >= $2 AND started_at < $3`,
		userID, from, to).Scan(&t.Calls, &t.TalkSeconds, &t.Spent, &t.Interested)
	if err != nil {
		return Totals{}, fmt.Errorf("add up calls: %w", err)
	}
	return t, nil
}

// Followup is a call the rep booked, or a lead who called and was missed.
type Followup struct {
	ID     string
	Lead   LeadRef
	DueAt  time.Time
	Reason string
	// Missed: the lead called the rep at DueAt and nobody answered.
	Missed      bool
	LastNote    string
	LastOutcome string
}

// FollowupCounts are how many open follow-ups fall in each tab.
type FollowupCounts struct{ Today, Tomorrow, Week, Later int }

// Followups lists open follow-ups in one tab: "today" (and anything
// overdue), "tomorrow", "week" (the rest of the next 7 days) or "later".
func (s *Service) Followups(ctx context.Context, userID, tab string) ([]Followup, FollowupCounts, error) {
	d, err := s.repDay(ctx, userID, s.now())
	if err != nil {
		return nil, FollowupCounts{}, err
	}
	tomorrowEnd, weekEnd := d.end.AddDate(0, 0, 1), d.start.AddDate(0, 0, 7)
	var c FollowupCounts
	err = s.DB.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE due_at < $2), count(*) FILTER (WHERE due_at >= $2 AND due_at < $3),
			count(*) FILTER (WHERE due_at >= $3 AND due_at < $4), count(*) FILTER (WHERE due_at >= $4)
		FROM followups WHERE user_id = $1 AND NOT done`, userID, d.end, tomorrowEnd, weekEnd).Scan(&c.Today, &c.Tomorrow, &c.Week, &c.Later)
	if err != nil {
		return nil, c, fmt.Errorf("count follow-ups: %w", err)
	}
	from, to := time.Time{}, d.end
	switch tab {
	case "tomorrow":
		from, to = d.end, tomorrowEnd
	case "week":
		from, to = tomorrowEnd, weekEnd
	case "later":
		from, to = weekEnd, time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	list, err := s.followups(ctx, userID, from, to, 200)
	return list, c, err
}

func (s *Service) followups(ctx context.Context, userID string, from, to time.Time, limit int) ([]Followup, error) {
	rows, err := s.DB.Query(ctx, `
		SELECT f.id, l.id, `+leadName+`, l.company, l.phone, f.due_at, f.reason, f.kind = 'missed_call',
			COALESCE(lc.note, ''), COALESCE(lc.outcome, '')
		FROM followups f JOIN leads l ON l.id = f.lead_id
		LEFT JOIN LATERAL (
			SELECT note, outcome FROM calls c WHERE c.lead_id = l.id AND c.outcome IS NOT NULL ORDER BY c.started_at DESC LIMIT 1
		) lc ON true
		WHERE f.user_id = $1 AND NOT f.done AND f.due_at >= $2 AND f.due_at < $3
		ORDER BY f.due_at LIMIT $4`, userID, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("list follow-ups: %w", err)
	}
	defer rows.Close()
	out := []Followup{}
	for rows.Next() {
		var f Followup
		if err := rows.Scan(&f.ID, &f.Lead.ID, &f.Lead.Name, &f.Lead.Company, &f.Lead.Phone, &f.DueAt, &f.Reason, &f.Missed, &f.LastNote, &f.LastOutcome); err != nil {
			return nil, fmt.Errorf("scan follow-up: %w", err)
		}
		f.Lead.HerTimeZone = herZone(f.Lead.Phone)
		out = append(out, f)
	}
	return out, rows.Err()
}

// FollowupDone ticks off a follow-up without calling.
func (s *Service) FollowupDone(ctx context.Context, userID, id string) error {
	if !uuidOK(id) {
		return ErrFollowupNotFound
	}
	tag, err := s.DB.Exec(ctx, `UPDATE followups SET done = true WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("finish follow-up: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrFollowupNotFound
	}
	return nil
}

// Today is the rep's day at a glance.
type Today struct {
	DialsToday int
	DialLimit  *int
	Today      Totals
	Yesterday  Totals
	DueToday   []Followup
	DueCount   int
	// Ready is the list to call next: the one called most recently with
	// leads left, else the newest; nil when no list has leads left.
	Ready *ReadyList
}

// ReadyList is a list with leads left to call.
type ReadyList struct {
	ID         string
	Name       string
	Left       int
	ScriptName string
}

// Today gathers the Today screen.
func (s *Service) Today(ctx context.Context, userID string) (Today, error) {
	now := s.now()
	d, err := s.repDay(ctx, userID, now)
	if err != nil {
		return Today{}, err
	}
	var t Today
	if t.Today, err = s.totals(ctx, userID, d.start, d.end); err != nil {
		return t, err
	}
	if t.Yesterday, err = s.totals(ctx, userID, d.start.AddDate(0, 0, -1), d.start); err != nil {
		return t, err
	}
	t.DialsToday = t.Today.Calls

	var verified bool
	var signedUp time.Time
	if err := s.DB.QueryRow(ctx, `
		SELECT created_at, EXISTS (SELECT 1 FROM verifications v WHERE v.user_id = u.id AND v.status = 'approved')
		FROM users u WHERE id = $1`, userID).Scan(&signedUp, &verified); err != nil {
		return t, fmt.Errorf("read rep: %w", err)
	}
	planID := plans.Free
	if sub, ok, err := plans.Current(ctx, s.DB, userID); err != nil {
		return t, err
	} else if ok {
		planID = sub.PlanID
	}
	if limit, ok := DailyLimit(planID, verified, signedUp, now); ok {
		t.DialLimit = &limit
	}

	if t.DueToday, err = s.followups(ctx, userID, time.Time{}, d.end, 5); err != nil {
		return t, err
	}
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM followups WHERE user_id = $1 AND NOT done AND due_at < $2`, userID, d.end).Scan(&t.DueCount); err != nil {
		return t, fmt.Errorf("count follow-ups: %w", err)
	}

	var r ReadyList
	err = s.DB.QueryRow(ctx, `
		SELECT ll.id, ll.name, COALESCE(sc.name, ''),
			(SELECT count(*) FROM leads l WHERE l.list_id = ll.id AND l.status IN ('new', 'called', 'callback', 'interested') AND l.attempts < $2)
		FROM lead_lists ll LEFT JOIN scripts sc ON sc.id = ll.script_id
		WHERE ll.user_id = $1 AND ll.region = 'us_ca'
		  AND EXISTS (SELECT 1 FROM leads l WHERE l.list_id = ll.id AND l.status IN ('new', 'called', 'callback', 'interested') AND l.attempts < $2)
		ORDER BY (SELECT max(c.started_at) FROM calls c JOIN leads l ON l.id = c.lead_id WHERE l.list_id = ll.id) DESC NULLS LAST, ll.created_at DESC
		LIMIT 1`, userID, MaxTries).Scan(&r.ID, &r.Name, &r.ScriptName, &r.Left)
	if err == nil {
		t.Ready = &r
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return t, fmt.Errorf("pick a list: %w", err)
	}
	return t, nil
}

// HistoryItem is one past call.
type HistoryItem struct {
	ID   string
	Lead *LeadRef
	// To is the other side's number: who the rep called, or who called.
	To string
	// Incoming: the lead called the rep. Answered says whether anyone picked up.
	Incoming  bool
	Answered  bool
	StartedAt time.Time
	Seconds   int64
	Cost      int64
	Outcome   string
	Note      string
}

// HistoryCursor marks where the next page starts.
type HistoryCursor struct {
	StartedAt time.Time
	ID        string
}

func (c HistoryCursor) String() string {
	return base64.RawURLEncoding.EncodeToString([]byte(c.StartedAt.UTC().Format(time.RFC3339Nano) + "|" + c.ID))
}

// ParseHistoryCursor reads a cursor from a page link.
func ParseHistoryCursor(s string) (*HistoryCursor, error) {
	if s == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, ErrBadCursor
	}
	at, id, ok := strings.Cut(string(b), "|")
	t, terr := time.Parse(time.RFC3339Nano, at)
	if !ok || terr != nil || !uuidOK(id) {
		return nil, ErrBadCursor
	}
	return &HistoryCursor{t, id}, nil
}

// History lists ended calls, newest first, optionally only one outcome or
// matching a name, company or number.
func (s *Service) History(ctx context.Context, userID, outcome, q string, after *HistoryCursor, limit int) ([]HistoryItem, *HistoryCursor, error) {
	if outcome != "" {
		if _, ok := leadStatus[Outcome(outcome)]; !ok {
			return nil, nil, ErrBadOutcome
		}
	}
	q = strings.TrimSpace(q)
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, q)
	afterAt, afterID := time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC), "ffffffff-ffff-ffff-ffff-ffffffffffff"
	if after != nil {
		afterAt, afterID = after.StartedAt, after.ID
	}
	rows, err := s.DB.Query(ctx, `
		SELECT c.id, COALESCE(l.id::text, ''), COALESCE(`+leadName+`, ''), COALESCE(l.company, ''), c.to_number, c.started_at,
			COALESCE(c.seconds, 0), COALESCE(c.cost_microdollars, 0), COALESCE(c.outcome, ''), COALESCE(c.note, ''),
			c.direction = 'inbound', c.answered_at IS NOT NULL
		FROM calls c LEFT JOIN leads l ON l.id = c.lead_id
		WHERE c.user_id = $1 AND c.status = 'ended'
		  AND ($2 = '' OR c.outcome = $2)
		  AND ($3 = '' OR l.first_name || ' ' || l.last_name ILIKE '%' || $3 || '%' OR l.company ILIKE '%' || $3 || '%'
		       OR ($4 <> '' AND c.to_number LIKE '%' || $4 || '%'))
		  AND (c.started_at, c.id) < ($5, $6::uuid)
		ORDER BY c.started_at DESC, c.id DESC LIMIT $7`,
		userID, outcome, q, digits, afterAt, afterID, limit+1)
	if err != nil {
		return nil, nil, fmt.Errorf("list calls: %w", err)
	}
	defer rows.Close()
	out := []HistoryItem{}
	for rows.Next() {
		var h HistoryItem
		var lead LeadRef
		if err := rows.Scan(&h.ID, &lead.ID, &lead.Name, &lead.Company, &h.To, &h.StartedAt, &h.Seconds, &h.Cost, &h.Outcome, &h.Note, &h.Incoming, &h.Answered); err != nil {
			return nil, nil, fmt.Errorf("scan call: %w", err)
		}
		if lead.ID != "" {
			lead.Phone = h.To
			h.Lead = &lead
		}
		out = append(out, h)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("list calls: %w", err)
	}
	var next *HistoryCursor
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		next = &HistoryCursor{last.StartedAt, last.ID}
	}
	return out, next, nil
}

// Week adds up the last 7 days of calls, for the History header.
func (s *Service) Week(ctx context.Context, userID string) (Totals, error) {
	d, err := s.repDay(ctx, userID, s.now())
	if err != nil {
		return Totals{}, err
	}
	return s.totals(ctx, userID, d.start.AddDate(0, 0, -6), d.end)
}
