// Package scripts keeps the call scripts reps read from while they call.
// A script is a list of parts (a title and some text). The text can hold
// fill-in words like {first_name}, filled with each lead's details on the
// call screen. Each lead list uses one script.
package scripts

import (
	"context"
	"encoding/json"
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

	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Fields are the fill-in words a script can use.
var Fields = []string{"first_name", "company", "city", "her_time"}

// FreeMonths is how long a Free rep sees their script on the call screen,
// counted from sign-up. After that it is part of Starter.
const FreeMonths = 2

const (
	maxScripts   = 50
	maxParts     = 30
	maxTitleLen  = 80
	maxBodyLen   = 3000
	maxScriptLen = 80
)

// Service runs scripts.
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

// Part is one section of a script.
type Part struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// ListRef names a lead list that uses a script.
type ListRef struct {
	ID   string
	Name string
}

// Script is a saved script and the lists that use it.
type Script struct {
	ID        string
	Name      string
	Parts     []Part
	Lists     []ListRef
	UpdatedAt time.Time
}

// Input is what a rep saves. ListIDs, when set, are exactly the lists that
// use the script afterwards; nil leaves the lists as they are.
type Input struct {
	Name    string
	Parts   []Part
	ListIDs *[]string
}

// Error is a failure the rep can act on. Message is shown on screen as is.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return "scripts: " + e.Code }

// Is matches errors by code, so a copy naming a word still matches.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

func unprocessable(code, message string) *Error {
	return &Error{http.StatusUnprocessableEntity, code, message}
}

var (
	ErrBadName       = unprocessable("invalid_name", fmt.Sprintf("Give the script a name, up to %d characters.", maxScriptLen))
	ErrNoParts       = unprocessable("no_parts", "Write your script before saving.")
	ErrTooManyParts  = unprocessable("too_many_parts", fmt.Sprintf("A script can have up to %d parts.", maxParts))
	ErrBadTitle      = unprocessable("invalid_title", fmt.Sprintf("Give every part a title, up to %d characters.", maxTitleLen))
	ErrTooLong       = unprocessable("part_too_long", fmt.Sprintf("Each part can be up to %d characters. Split the long one in two.", maxBodyLen))
	ErrUnknownField  = unprocessable("unknown_field", "Use only first_name, company, city or her_time in curly brackets.")
	ErrTooMany       = unprocessable("too_many_scripts", fmt.Sprintf("You can keep up to %d scripts. Delete one you don't use.", maxScripts))
	ErrNameTaken     = &Error{http.StatusConflict, "name_taken", "You already have a script with that name. Pick another."}
	ErrNotFound      = &Error{http.StatusNotFound, "script_not_found", "That script doesn't exist."}
	ErrListNotFound  = &Error{http.StatusNotFound, "list_not_found", "One of those lists doesn't exist."}
	fieldRE          = regexp.MustCompile(`\{([^{}\s]*)\}`)
	uuidRE           = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	knownField       = map[string]bool{}
	errUniqueViolate = "23505"
)

func init() {
	for _, f := range Fields {
		knownField[f] = true
	}
}

// clean tidies and checks what a rep wants to save.
func clean(in Input) (Input, error) {
	in.Name = strings.Join(strings.Fields(in.Name), " ")
	if in.Name == "" || utf8.RuneCountInString(in.Name) > maxScriptLen {
		return in, ErrBadName
	}
	if len(in.Parts) > maxParts {
		return in, ErrTooManyParts
	}
	parts := make([]Part, 0, len(in.Parts))
	written := false
	for _, p := range in.Parts {
		p.Title = strings.Join(strings.Fields(p.Title), " ")
		p.Body = strings.TrimSpace(strings.ReplaceAll(p.Body, "\r\n", "\n"))
		if p.Title == "" || utf8.RuneCountInString(p.Title) > maxTitleLen {
			return in, ErrBadTitle
		}
		if utf8.RuneCountInString(p.Body) > maxBodyLen {
			return in, ErrTooLong
		}
		for _, m := range fieldRE.FindAllStringSubmatch(p.Body, -1) {
			if !knownField[m[1]] {
				e := *ErrUnknownField
				e.Message = fmt.Sprintf("{%s} isn't a detail we can fill in. %s", m[1], ErrUnknownField.Message)
				return in, &e
			}
		}
		written = written || p.Body != ""
		parts = append(parts, p)
	}
	if !written {
		return in, ErrNoParts
	}
	in.Parts = parts
	if in.ListIDs != nil {
		seen := map[string]bool{}
		ids := []string{}
		for _, id := range *in.ListIDs {
			if !uuidRE.MatchString(id) {
				return in, ErrListNotFound
			}
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
		in.ListIDs = &ids
	}
	return in, nil
}

// List returns the rep's scripts, most recently changed first.
func (s *Service) List(ctx context.Context, userID string) ([]Script, error) {
	return list(ctx, s.DB, userID, "")
}

func list(ctx context.Context, q platform.Querier, userID, onlyID string) ([]Script, error) {
	rows, err := q.Query(ctx, `
		SELECT s.id, s.name, s.parts, s.updated_at,
			COALESCE(json_agg(json_build_object('id', l.id, 'name', l.name) ORDER BY l.created_at) FILTER (WHERE l.id IS NOT NULL), '[]')
		FROM scripts s LEFT JOIN lead_lists l ON l.script_id = s.id
		WHERE s.user_id = $1 AND ($2 = '' OR s.id::text = $2)
		GROUP BY s.id
		ORDER BY s.updated_at DESC, s.name`, userID, onlyID)
	if err != nil {
		return nil, fmt.Errorf("read scripts: %w", err)
	}
	defer rows.Close()
	out := []Script{}
	for rows.Next() {
		var sc Script
		var parts, lists []byte
		if err := rows.Scan(&sc.ID, &sc.Name, &parts, &sc.UpdatedAt, &lists); err != nil {
			return nil, fmt.Errorf("scan script: %w", err)
		}
		if err := json.Unmarshal(parts, &sc.Parts); err != nil {
			return nil, fmt.Errorf("read script parts: %w", err)
		}
		var refs []struct{ ID, Name string }
		if err := json.Unmarshal(lists, &refs); err != nil {
			return nil, fmt.Errorf("read script lists: %w", err)
		}
		sc.Lists = make([]ListRef, len(refs))
		for i, r := range refs {
			sc.Lists[i] = ListRef(r)
		}
		out = append(out, sc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read scripts: %w", err)
	}
	return out, nil
}

// Create saves a new script.
func (s *Service) Create(ctx context.Context, userID string, in Input) (Script, error) {
	in, err := clean(in)
	if err != nil {
		return Script{}, err
	}
	var id string
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		// One save at a time per rep, so the script count can't be raced past.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('scripts:' || $1::text, 0))`, userID); err != nil {
			return fmt.Errorf("lock scripts: %w", err)
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM scripts WHERE user_id = $1`, userID).Scan(&n); err != nil {
			return fmt.Errorf("count scripts: %w", err)
		}
		if n >= maxScripts {
			return ErrTooMany
		}
		parts, _ := json.Marshal(in.Parts)
		err := tx.QueryRow(ctx, `INSERT INTO scripts (user_id, name, parts) VALUES ($1, $2, $3) RETURNING id`,
			userID, in.Name, parts).Scan(&id)
		if err != nil {
			return nameErr(err, "insert script")
		}
		return useFor(ctx, tx, userID, id, in.ListIDs)
	})
	if err != nil {
		return Script{}, err
	}
	return s.get(ctx, userID, id)
}

// Update replaces a script's name and parts, and which lists use it.
func (s *Service) Update(ctx context.Context, userID, id string, in Input) (Script, error) {
	if !uuidRE.MatchString(id) {
		return Script{}, ErrNotFound
	}
	in, err := clean(in)
	if err != nil {
		return Script{}, err
	}
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		parts, _ := json.Marshal(in.Parts)
		tag, err := tx.Exec(ctx, `UPDATE scripts SET name = $3, parts = $4, updated_at = now() WHERE id = $1 AND user_id = $2`,
			id, userID, in.Name, parts)
		if err != nil {
			return nameErr(err, "update script")
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return useFor(ctx, tx, userID, id, in.ListIDs)
	})
	if err != nil {
		return Script{}, err
	}
	return s.get(ctx, userID, id)
}

// useFor makes exactly listIDs use the script (nil: leave lists alone).
// A list moved here stops using its old script.
func useFor(ctx context.Context, tx pgx.Tx, userID, scriptID string, listIDs *[]string) error {
	if listIDs == nil {
		return nil
	}
	ids := *listIDs
	if _, err := tx.Exec(ctx, `UPDATE lead_lists SET script_id = NULL WHERE user_id = $1 AND script_id = $2 AND NOT (id::text = ANY($3))`,
		userID, scriptID, ids); err != nil {
		return fmt.Errorf("clear list scripts: %w", err)
	}
	if len(ids) == 0 {
		return nil
	}
	tag, err := tx.Exec(ctx, `UPDATE lead_lists SET script_id = $2 WHERE user_id = $1 AND id::text = ANY($3)`, userID, scriptID, ids)
	if err != nil {
		return fmt.Errorf("set list scripts: %w", err)
	}
	if int(tag.RowsAffected()) != len(ids) {
		return ErrListNotFound
	}
	return nil
}

func nameErr(err error, what string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == errUniqueViolate {
		return ErrNameTaken
	}
	return fmt.Errorf("%s: %w", what, err)
}

func (s *Service) get(ctx context.Context, userID, id string) (Script, error) {
	all, err := list(ctx, s.DB, userID, id)
	if err != nil {
		return Script{}, err
	}
	if len(all) == 0 {
		return Script{}, ErrNotFound
	}
	return all[0], nil
}

// Delete removes a script. Lists that used it are left without one.
func (s *Service) Delete(ctx context.Context, userID, id string) error {
	if !uuidRE.MatchString(id) {
		return ErrNotFound
	}
	tag, err := s.DB.Exec(ctx, `DELETE FROM scripts WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete script: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// FreeUntil is the day a Free rep's script stops showing on the call
// screen: FreeMonths after sign-up. It is nil on Starter and Pro, where the
// script always shows.
func FreeUntil(ctx context.Context, q platform.Querier, userID string) (*time.Time, error) {
	_, paid, err := plans.Current(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	if paid {
		return nil, nil
	}
	var created time.Time
	if err := q.QueryRow(ctx, `SELECT created_at FROM users WHERE id = $1`, userID).Scan(&created); err != nil {
		return nil, fmt.Errorf("read sign-up date: %w", err)
	}
	c := created.UTC()
	until := time.Date(c.Year(), c.Month(), c.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, FreeMonths, 0)
	return &until, nil
}
