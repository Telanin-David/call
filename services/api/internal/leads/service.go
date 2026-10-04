// Package leads keeps a rep's lead lists: uploading a CSV, matching its
// columns, and leaving out rows that can't or mustn't be called (bad
// numbers, premium-rate lines, duplicates, the do-not-call list, numbers
// already in another list). Numbers outside the US and Canada go into a list
// of their own, because they cost more to call.
package leads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/phone"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Service runs lead lists.
type Service struct {
	DB  *pgxpool.Pool
	Log *slog.Logger
}

func (s *Service) log() *slog.Logger {
	if s.Log == nil {
		return slog.Default()
	}
	return s.Log
}

// Reason is why a row doesn't go into the new list.
type Reason string

const (
	Invalid   Reason = "invalid"   // not a full phone number
	Premium   Reason = "premium"   // a premium-rate line, never called
	Duplicate Reason = "duplicate" // the same number earlier in the file
	DNC       Reason = "dnc"       // on the rep's do-not-call list
	Listed    Reason = "listed"    // already in one of the rep's lists
	Abroad    Reason = "abroad"    // outside the US and Canada: goes in a list of its own
)

// LeftOut is a row that isn't added to the new list.
type LeftOut struct {
	Lead     Lead
	RawPhone string // as written in the file
	Reason   Reason
	SameAs   int    // Duplicate: the line it repeats
	ListName string // Listed: the list it's already in
}

// Check is what an upload would do.
type Check struct {
	File    File
	Mapping []Field
	// Problem is set when the mapping can't be used yet, for example no
	// column is picked for phone numbers. Nothing is counted until it's fixed.
	Problem *Error
	Ready   []Lead // US and Canada numbers for the new list
	Abroad  []Lead // numbers for the separate list
	LeftOut []LeftOut
}

// Check reads a file and says what uploading it would add and leave out.
// With no mapping, it suggests one from the column names.
func (s *Service) Check(ctx context.Context, userID, text string, mapping []Field) (Check, error) {
	f, err := ReadCSV(text)
	if err != nil {
		return Check{}, err
	}
	if mapping == nil {
		mapping = Suggest(f)
	}
	if err := checkMapping(mapping, len(f.Headers)); err != nil {
		var e *Error
		if errors.As(err, &e) && !errors.Is(err, ErrBadMapping) {
			return Check{File: f, Mapping: mapping, Problem: e}, nil
		}
		return Check{}, err
	}
	return check(ctx, s.DB, userID, f, mapping)
}

func check(ctx context.Context, q platform.Querier, userID string, f File, m []Field) (Check, error) {
	c := Check{File: f, Mapping: m}
	type parsed struct {
		lead Lead
		raw  string
		err  error
	}
	rows := make([]parsed, len(f.Rows))
	var numbers []string
	for i, r := range f.Rows {
		l, raw := read(r, m)
		var err error
		l.Phone, err = phone.Parse(raw)
		rows[i] = parsed{l, raw, err}
		if err == nil {
			numbers = append(numbers, l.Phone)
		}
	}
	dnc, listed, err := known(ctx, q, userID, numbers)
	if err != nil {
		return Check{}, err
	}

	firstLine := map[string]int{}
	for _, p := range rows {
		out := LeftOut{Lead: p.lead, RawPhone: p.raw}
		switch {
		case p.err != nil:
			out.Reason = Invalid
		case phone.Premium(p.lead.Phone):
			out.Reason = Premium
		case firstLine[p.lead.Phone] != 0:
			out.Reason, out.SameAs = Duplicate, firstLine[p.lead.Phone]
		case dnc[p.lead.Phone]:
			out.Reason = DNC
		case listed[p.lead.Phone] != "":
			out.Reason, out.ListName = Listed, listed[p.lead.Phone]
		case phone.RegionOf(p.lead.Phone) == phone.Abroad:
			out.Reason = Abroad
			c.Abroad = append(c.Abroad, p.lead)
		default:
			c.Ready = append(c.Ready, p.lead)
		}
		if p.err == nil && firstLine[p.lead.Phone] == 0 {
			firstLine[p.lead.Phone] = p.lead.Line
		}
		if out.Reason != "" {
			c.LeftOut = append(c.LeftOut, out)
		}
	}
	return c, nil
}

// known looks up which numbers are on the rep's do-not-call list and which
// are already in one of their lists (and which list).
func known(ctx context.Context, q platform.Querier, userID string, numbers []string) (map[string]bool, map[string]string, error) {
	dnc := map[string]bool{}
	listed := map[string]string{}
	if len(numbers) == 0 {
		return dnc, listed, nil
	}
	rows, err := q.Query(ctx, `SELECT phone FROM dnc_entries WHERE user_id = $1 AND phone = ANY($2)`, userID, numbers)
	if err != nil {
		return nil, nil, fmt.Errorf("read do-not-call list: %w", err)
	}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			rows.Close()
			return nil, nil, fmt.Errorf("scan do-not-call: %w", err)
		}
		dnc[p] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("read do-not-call list: %w", err)
	}

	rows, err = q.Query(ctx, `
		SELECT DISTINCT ON (l.phone) l.phone, ll.name
		FROM leads l JOIN lead_lists ll ON ll.id = l.list_id
		WHERE l.user_id = $1 AND l.phone = ANY($2)
		ORDER BY l.phone, ll.created_at`, userID, numbers)
	if err != nil {
		return nil, nil, fmt.Errorf("read listed numbers: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p, name string
		if err := rows.Scan(&p, &name); err != nil {
			return nil, nil, fmt.Errorf("scan listed number: %w", err)
		}
		listed[p] = name
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("read listed numbers: %w", err)
	}
	return dnc, listed, nil
}

// AbroadSuffix names the separate list for numbers outside the US and Canada.
const AbroadSuffix = " · outside US and Canada"

// Add uploads a file as a new list named name, plus a separate list for any
// numbers outside the US and Canada. It checks everything again on the
// server, inside one transaction, so the result matches the rules at the
// moment of saving.
func (s *Service) Add(ctx context.Context, userID, text string, mapping []Field, name string) ([]List, error) {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return nil, ErrBadListName
	}
	f, err := ReadCSV(text)
	if err != nil {
		return nil, err
	}
	if err := checkMapping(mapping, len(f.Headers)); err != nil {
		return nil, err
	}

	var ids []string
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		// One upload at a time per rep, so two at once can't both add a number.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('leads:' || $1::text, 0))`, userID); err != nil {
			return fmt.Errorf("lock leads: %w", err)
		}
		c, err := check(ctx, tx, userID, f, mapping)
		if err != nil {
			return err
		}
		if len(c.Ready) == 0 && len(c.Abroad) == 0 {
			return ErrNothingToAdd
		}
		groups := []struct {
			name   string
			region phone.Region
			leads  []Lead
		}{
			{name, phone.USCA, c.Ready},
			{clip(name, 80-utf8.RuneCountInString(AbroadSuffix)) + AbroadSuffix, phone.Abroad, c.Abroad},
		}
		for _, g := range groups {
			if len(g.leads) == 0 {
				continue
			}
			id, err := insertList(ctx, tx, userID, g.name, g.region, g.leads)
			if err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return listsByID(ctx, s.DB, userID, ids)
}

func insertList(ctx context.Context, tx pgx.Tx, userID, name string, region phone.Region, leads []Lead) (string, error) {
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO lead_lists (user_id, name, region) VALUES ($1, $2, $3) RETURNING id`,
		userID, name, string(region)).Scan(&id); err != nil {
		return "", fmt.Errorf("insert list: %w", err)
	}
	rows := make([][]any, len(leads))
	for i, l := range leads {
		rows[i] = []any{id, userID, l.FirstName, l.LastName, l.Company, l.Phone, l.Email, l.City, l.Notes}
	}
	_, err := tx.CopyFrom(ctx, pgx.Identifier{"leads"},
		[]string{"list_id", "user_id", "first_name", "last_name", "company", "phone", "email", "city", "notes"},
		pgx.CopyFromRows(rows))
	if err != nil {
		return "", fmt.Errorf("insert leads: %w", err)
	}
	return id, nil
}

// List is one of a rep's lead lists with its progress.
type List struct {
	ID         string
	Name       string
	Region     phone.Region
	ScriptID   *string
	ScriptName *string
	Total      int
	Called     int
	Followups  int
	CreatedAt  time.Time
}

// Status is how the lists page labels a list.
func (l List) Status() string {
	switch {
	case l.Region == phone.Abroad:
		return "abroad"
	case l.Called == 0:
		return "new"
	case l.Called >= l.Total:
		return "done"
	}
	return "active"
}

const listSelect = `
	SELECT ll.id, ll.name, ll.region, s.id, s.name, ll.created_at,
		(SELECT count(*) FROM leads l WHERE l.list_id = ll.id),
		(SELECT count(*) FROM leads l WHERE l.list_id = ll.id AND l.attempts > 0),
		(SELECT count(*) FROM followups f JOIN leads l ON l.id = f.lead_id WHERE l.list_id = ll.id AND NOT f.done)
	FROM lead_lists ll LEFT JOIN scripts s ON s.id = ll.script_id
	WHERE ll.user_id = $1`

// Lists returns the rep's lists, newest first.
func Lists(ctx context.Context, q platform.Querier, userID string) ([]List, error) {
	return scanLists(q.Query(ctx, listSelect+` ORDER BY ll.created_at DESC, ll.name`, userID))
}

func listsByID(ctx context.Context, q platform.Querier, userID string, ids []string) ([]List, error) {
	return scanLists(q.Query(ctx, listSelect+` AND ll.id = ANY($2) ORDER BY ll.region DESC, ll.name`, userID, ids))
}

func scanLists(rows pgx.Rows, err error) ([]List, error) {
	if err != nil {
		return nil, fmt.Errorf("read lists: %w", err)
	}
	defer rows.Close()
	out := []List{}
	for rows.Next() {
		var l List
		var region string
		if err := rows.Scan(&l.ID, &l.Name, &region, &l.ScriptID, &l.ScriptName, &l.CreatedAt, &l.Total, &l.Called, &l.Followups); err != nil {
			return nil, fmt.Errorf("scan list: %w", err)
		}
		l.Region = phone.Region(region)
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read lists: %w", err)
	}
	return out, nil
}

var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Delete removes a list and its leads. A list with calls is kept, because
// the calls and their charges must stay in the rep's history.
func (s *Service) Delete(ctx context.Context, userID, listID string) error {
	if !uuidRE.MatchString(listID) {
		return ErrListNotFound
	}
	return platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		// The same lock a call takes to start, so no call starts on this
		// list while it goes.
		if err := ledger.Lock(ctx, tx, userID); err != nil {
			return err
		}
		var exists, onCall bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM lead_lists WHERE id = $1 AND user_id = $2),
			       EXISTS (SELECT 1 FROM calls c JOIN leads l ON l.id = c.lead_id
			               WHERE l.list_id = $1 AND c.user_id = $2 AND c.status <> 'ended')`, listID, userID).Scan(&exists, &onCall); err != nil {
			return fmt.Errorf("check list: %w", err)
		}
		if !exists {
			return ErrListNotFound
		}
		if onCall {
			return ErrListOnCall
		}
		// Leads go with the list, and their follow-ups with them. Calls stay
		// in history, without the link to the lead.
		if _, err := tx.Exec(ctx, `DELETE FROM lead_lists WHERE id = $1 AND user_id = $2`, listID, userID); err != nil {
			return fmt.Errorf("delete list: %w", err)
		}
		return nil
	})
}

// AddDNC puts a number on the rep's do-not-call list. Adding it twice is fine.
func AddDNC(ctx context.Context, q platform.Querier, userID, e164, source string) error {
	if _, err := q.Exec(ctx, `
		INSERT INTO dnc_entries (user_id, phone, source) VALUES ($1, $2, $3)
		ON CONFLICT (user_id, phone) DO NOTHING`, userID, e164, source); err != nil {
		return fmt.Errorf("add do-not-call: %w", err)
	}
	return nil
}
