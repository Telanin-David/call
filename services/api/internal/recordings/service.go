package recordings

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/plans"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/storage"
	"github.com/telanin-david/call/services/api/internal/telephony"
)

const (
	// Keep is how long a recording is kept (open decision 6: 90 days).
	Keep = 90 * 24 * time.Hour
	// LinkLife is how long a play or download link works.
	LinkLife = 10 * time.Minute
	// copyTries is how often a copy is tried before it is marked failed.
	copyTries = 5
)

// Service keeps recordings.
type Service struct {
	DB *pgxpool.Pool
	// Provider fetches recordings from the phone provider.
	Provider telephony.Calls
	// Store keeps the files; nil means recording is off.
	Store storage.Store
	Log   *slog.Logger
	Now   func() time.Time
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

// Error is a refusal in the words the rep sees.
type Error struct {
	Status  int
	Code    string
	Message string
	Action  string
}

func (e *Error) Error() string { return "recordings: " + e.Code }

var (
	ErrNotFound    = &Error{http.StatusNotFound, "recording_not_found", "That call has no recording.", ""}
	ErrNotPro      = &Error{http.StatusForbidden, "recording_plan", "Recording is part of Pro.", "upgrade"}
	ErrMustAgree   = &Error{http.StatusUnprocessableEntity, "recording_agree", "Agree to tell every lead the call may be recorded first.", ""}
	ErrUnavailable = &Error{http.StatusServiceUnavailable, "recording_unavailable", "Recording isn't working right now. Try again later.", ""}
)

// Setting is whether the rep's calls are recorded.
type Setting struct {
	// On: answered calls are recorded (Pro, and the rep agreed).
	On bool
	// AgreedAt is when the rep agreed to tell leads; nil when off.
	AgreedAt *time.Time
	Pro      bool
	// Available is false when recording isn't set up on this server.
	Available bool
}

// Setting reads the rep's recording setting.
func (s *Service) Setting(ctx context.Context, userID string) (Setting, error) {
	var st Setting
	if err := s.DB.QueryRow(ctx, `SELECT recording_agreed_at FROM users WHERE id = $1`, userID).Scan(&st.AgreedAt); err != nil {
		return st, fmt.Errorf("read recording setting: %w", err)
	}
	sub, ok, err := plans.Current(ctx, s.DB, userID)
	if err != nil {
		return st, err
	}
	st.Pro = ok && sub.PlanID == plans.Pro
	st.Available = s.Store != nil
	st.On = st.Pro && st.Available && st.AgreedAt != nil
	return st, nil
}

// SetRecording turns recording on (Pro only, and only when the rep agrees
// to tell every lead) or off.
func (s *Service) SetRecording(ctx context.Context, userID string, on, agree bool) (Setting, error) {
	if on {
		st, err := s.Setting(ctx, userID)
		if err != nil {
			return st, err
		}
		switch {
		case !st.Available:
			return st, ErrUnavailable
		case !st.Pro:
			return st, ErrNotPro
		case !agree:
			return st, ErrMustAgree
		}
		if _, err := s.DB.Exec(ctx, `UPDATE users SET recording_agreed_at = COALESCE(recording_agreed_at, $2) WHERE id = $1`, userID, s.now()); err != nil {
			return st, fmt.Errorf("turn recording on: %w", err)
		}
	} else if _, err := s.DB.Exec(ctx, `UPDATE users SET recording_agreed_at = NULL WHERE id = $1`, userID); err != nil {
		return Setting{}, fmt.Errorf("turn recording off: %w", err)
	}
	return s.Setting(ctx, userID)
}

// CopyPending copies recordings the provider has saved into our storage,
// a few at a time. It returns how many it handled.
func (s *Service) CopyPending(ctx context.Context) (int, error) {
	if s.Store == nil || s.Provider == nil {
		return 0, nil
	}
	n := 0
	for n < 20 {
		did, err := s.copyOne(ctx)
		if err != nil || !did {
			return n, err
		}
		n++
	}
	return n, nil
}

// copyOne copies the oldest saved recording. Other workers skip the one
// being copied.
func (s *Service) copyOne(ctx context.Context) (bool, error) {
	did := false
	err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var id, callID, userID, source string
		var tries int
		err := tx.QueryRow(ctx, `
			SELECT r.id, r.call_id, c.user_id, COALESCE(r.source_url, ''), r.tries
			FROM recordings r JOIN calls c ON c.id = r.call_id
			WHERE r.status = 'saved' ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`).Scan(&id, &callID, &userID, &source, &tries)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("next recording: %w", err)
		}
		did = true
		key, ct, size, err := s.copyFile(ctx, source, "recordings/"+userID+"/"+callID)
		if err != nil {
			tries++
			status := "saved"
			if tries >= copyTries {
				status = "failed"
			}
			s.log().ErrorContext(ctx, "copy recording", "call_id", callID, "try", tries, "err", err)
			_, uerr := tx.Exec(ctx, `UPDATE recordings SET tries = $2, status = $3, source_url = CASE WHEN $3 = 'failed' THEN NULL ELSE source_url END WHERE id = $1`,
				id, tries, status)
			return uerr
		}
		_, err = tx.Exec(ctx, `
			UPDATE recordings SET status = 'stored', storage_key = $2, content_type = $3, bytes = $4, stored_at = $5, source_url = NULL, tries = tries + 1
			WHERE id = $1`, id, key, ct, size, s.now())
		return err
	})
	return did, err
}

// copyFile downloads a recording to a temporary file (storage wants its
// size up front), then stores it under base plus the file's ending.
func (s *Service) copyFile(ctx context.Context, source, base string) (string, string, int64, error) {
	rec, err := s.Provider.FetchRecording(ctx, source)
	if err != nil {
		return "", "", 0, err
	}
	defer func() { _ = rec.Body.Close() }()
	tmp, err := os.CreateTemp("", "recording-*")
	if err != nil {
		return "", "", 0, fmt.Errorf("temp file: %w", err)
	}
	defer func() { _ = tmp.Close(); _ = os.Remove(tmp.Name()) }()
	size, err := io.Copy(tmp, rec.Body)
	if err != nil {
		return "", "", 0, fmt.Errorf("download recording: %w", err)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return "", "", 0, fmt.Errorf("temp file: %w", err)
	}
	key := base + rec.Ext
	if err := s.Store.Put(ctx, key, tmp, size, rec.ContentType); err != nil {
		return "", "", 0, err
	}
	return key, rec.ContentType, size, nil
}

// Recording is one call's recording, as the rep sees it.
type Recording struct {
	CallID string
	// Status is "processing" (being saved), "ready", "failed" or "deleted".
	Status  string
	Seconds int64
	// URL plays it and DownloadURL saves it; both work for LinkLife. Set
	// only when ready.
	URL         string
	DownloadURL string
	// KeepUntil is when it is deleted on its own.
	KeepUntil *time.Time
	Call      CallInfo
}

// CallInfo is the call the recording belongs to.
type CallInfo struct {
	LeadID      string
	LeadName    string
	LeadCompany string
	To          string
	Incoming    bool
	StartedAt   time.Time
	Seconds     int64
	Cost        int64
	Outcome     string
	Note        string
}

// Get reads the recording of one of the rep's calls, with fresh links.
func (s *Service) Get(ctx context.Context, userID, callID string) (Recording, error) {
	if !uuidOK(callID) {
		return Recording{}, ErrNotFound
	}
	var r Recording
	var status, key string
	var stored *time.Time
	c := &r.Call
	err := s.DB.QueryRow(ctx, `
		SELECT r.status, COALESCE(r.storage_key, ''), COALESCE(r.seconds, 0), r.stored_at,
			COALESCE(l.id::text, ''), COALESCE(NULLIF(trim(l.first_name || ' ' || l.last_name), ''), NULLIF(l.company, ''), l.phone, ''), COALESCE(l.company, ''),
			ca.to_number, ca.direction = 'inbound', ca.started_at, COALESCE(ca.seconds, 0), COALESCE(ca.cost_microdollars, 0), COALESCE(ca.outcome, ''), COALESCE(ca.note, '')
		FROM recordings r JOIN calls ca ON ca.id = r.call_id LEFT JOIN leads l ON l.id = ca.lead_id
		WHERE r.call_id = $1 AND ca.user_id = $2`, callID, userID).Scan(&status, &key, &r.Seconds, &stored,
		&c.LeadID, &c.LeadName, &c.LeadCompany, &c.To, &c.Incoming, &c.StartedAt, &c.Seconds, &c.Cost, &c.Outcome, &c.Note)
	if errors.Is(err, pgx.ErrNoRows) {
		return Recording{}, ErrNotFound
	}
	if err != nil {
		return Recording{}, fmt.Errorf("read recording: %w", err)
	}
	r.CallID = callID
	switch status {
	case "recording", "saved":
		r.Status = "processing"
	case "stored":
		r.Status = "ready"
	default:
		r.Status = status
	}
	if r.Status == "ready" {
		if s.Store == nil {
			return Recording{}, ErrUnavailable
		}
		until := stored.Add(Keep)
		r.KeepUntil = &until
		now := s.now()
		if r.URL, err = s.Store.Link(key, LinkLife, "", now); err != nil {
			return Recording{}, err
		}
		name := "call-" + c.StartedAt.UTC().Format("2006-01-02-1504") + path.Ext(key)
		if r.DownloadURL, err = s.Store.Link(key, LinkLife, name, now); err != nil {
			return Recording{}, err
		}
	}
	return r, nil
}

// Delete removes a recording for good: the file, and with it any
// transcript and summary. Deleting it again is not an error.
func (s *Service) Delete(ctx context.Context, userID, callID string) error {
	if !uuidOK(callID) {
		return ErrNotFound
	}
	return platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var id, status, key string
		err := tx.QueryRow(ctx, `
			SELECT r.id, r.status, COALESCE(r.storage_key, '') FROM recordings r JOIN calls c ON c.id = r.call_id
			WHERE r.call_id = $1 AND c.user_id = $2 FOR UPDATE OF r`, callID, userID).Scan(&id, &status, &key)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read recording: %w", err)
		}
		if status == "deleted" {
			return nil
		}
		return s.deleteFile(ctx, tx, id, key)
	})
}

func (s *Service) deleteFile(ctx context.Context, tx pgx.Tx, id, key string) error {
	if key != "" {
		if s.Store == nil {
			return ErrUnavailable
		}
		if err := s.Store.Delete(ctx, key); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `
		UPDATE recordings SET status = 'deleted', deleted_at = $2, storage_key = NULL, source_url = NULL, transcript = NULL, summary = NULL, suggested_followup = NULL
		WHERE id = $1`, id, s.now())
	if err != nil {
		return fmt.Errorf("delete recording: %w", err)
	}
	return nil
}

// Expire deletes recordings kept longer than Keep. It returns how many.
func (s *Service) Expire(ctx context.Context) (int, error) {
	if s.Store == nil {
		return 0, nil
	}
	n := 0
	for {
		did := false
		err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
			var id, key string
			err := tx.QueryRow(ctx, `SELECT id, COALESCE(storage_key, '') FROM recordings WHERE status = 'stored' AND stored_at < $1
				ORDER BY stored_at LIMIT 1 FOR UPDATE SKIP LOCKED`, s.now().Add(-Keep)).Scan(&id, &key)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return fmt.Errorf("old recordings: %w", err)
			}
			did = true
			return s.deleteFile(ctx, tx, id, key)
		})
		if err != nil || !did {
			return n, err
		}
		n++
	}
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
			if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
				return false
			}
		}
	}
	return true
}
