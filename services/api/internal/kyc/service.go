package kyc

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/notify"
)

// Limits on what a rep sends and how often.
const (
	MaxImageBytes    = 3 << 20
	MaxLivenessBytes = 1 << 20
	MaxLiveness      = 8
	// TriesPerDay is how many checks a rep can start in 24 hours. Each one
	// costs money at the provider.
	TriesPerDay = 3
)

// IDTypes are the IDs the Verify screen offers.
var IDTypes = map[string]bool{"national_id": true, "passport": true, "drivers_licence": true, "ghana_card": true, "kenya_id": true}

// Error is a refusal in the words the rep sees.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return "kyc: " + e.Code }

var (
	ErrBadIDType       = &Error{http.StatusUnprocessableEntity, "invalid_id_type", "Pick the kind of ID you have."}
	ErrBadCountry      = &Error{http.StatusUnprocessableEntity, "invalid_country", "Pick the country that gave you the ID."}
	ErrBadImage        = &Error{http.StatusUnprocessableEntity, "invalid_image", "That photo couldn't be read. Take it again."}
	ErrNoSelfie        = &Error{http.StatusUnprocessableEntity, "no_selfie", "The face check didn't take a photo. Do it again."}
	ErrAlreadyVerified = &Error{http.StatusConflict, "already_verified", "Your ID is already verified."}
	ErrPending         = &Error{http.StatusConflict, "check_running", "We're still checking your last photos. You'll get an email when it's done."}
	ErrTooManyTries    = &Error{http.StatusTooManyRequests, "too_many_tries", fmt.Sprintf("You've tried %d times today. Try again tomorrow, or contact support.", TriesPerDay)}
	ErrUnavailable     = &Error{http.StatusServiceUnavailable, "kyc_unavailable", "The ID check isn't working right now. Try again in a few minutes."}
)

// Status is where a rep's ID check stands. Review is approved by the
// provider but waiting for a person, because the name doesn't match.
type Status string

const (
	None     Status = "none"
	Pending  Status = "pending"
	Review   Status = "review"
	Verified Status = "approved"
	Failed   Status = "rejected"
)

// Check is a rep's latest ID check.
type Check struct {
	ID          string
	Status      Status
	IDType      string
	Country     string
	Reason      string
	SubmittedAt time.Time
	DecidedAt   *time.Time
}

// Input is what the Verify screen sends: images as base64 or data URLs.
type Input struct {
	IDType   string
	Country  string
	IDImage  string
	Selfie   string
	Liveness []string
}

// Service runs ID checks.
type Service struct {
	DB       *pgxpool.Pool
	Provider Provider // nil: the ID check is off
	Mail     notify.Mailer
	Log      *slog.Logger
	Now      func() time.Time
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

var countryRE = regexp.MustCompile(`^[A-Z]{2}$`)

// decodeImage reads a base64 or data-URL image and checks it is a JPEG or PNG.
func decodeImage(s string, max int) ([]byte, bool) {
	if i := strings.Index(s, ","); strings.HasPrefix(s, "data:") && i > 0 {
		s = s[i+1:]
	}
	if s == "" || base64.StdEncoding.DecodedLen(len(s)) > max+3 {
		return nil, false
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(b) > max {
		return nil, false
	}
	jpeg := bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF})
	png := bytes.HasPrefix(b, []byte{0x89, 'P', 'N', 'G'})
	return b, jpeg || png
}

const checkCols = `id, CASE WHEN needs_review THEN 'review' ELSE status::text END, COALESCE(id_type, ''), country, reason, created_at, result_at`

func scanCheck(row pgx.Row) (Check, error) {
	var c Check
	var st string
	err := row.Scan(&c.ID, &st, &c.IDType, &c.Country, &c.Reason, &c.SubmittedAt, &c.DecidedAt)
	c.Status = Status(st)
	return c, err
}

// Latest is the rep's most recent check; Status None when there is none.
func (s *Service) Latest(ctx context.Context, userID string) (Check, error) {
	c, err := scanCheck(s.DB.QueryRow(ctx, `SELECT `+checkCols+` FROM verifications WHERE user_id = $1 ORDER BY created_at DESC, (status = 'pending') DESC LIMIT 1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Check{Status: None}, nil
	}
	if err != nil {
		return Check{}, fmt.Errorf("read check: %w", err)
	}
	return c, nil
}

// Start checks what the rep sent, records a pending check and sends it to
// the provider. The images are passed on and never stored here.
func (s *Service) Start(ctx context.Context, u auth.User, in Input) (Check, error) {
	if !IDTypes[in.IDType] {
		return Check{}, ErrBadIDType
	}
	if !countryRE.MatchString(in.Country) {
		return Check{}, ErrBadCountry
	}
	idImage, ok := decodeImage(in.IDImage, MaxImageBytes)
	if !ok {
		return Check{}, ErrBadImage
	}
	selfie, ok := decodeImage(in.Selfie, MaxImageBytes)
	if !ok {
		return Check{}, ErrNoSelfie
	}
	if len(in.Liveness) > MaxLiveness {
		in.Liveness = in.Liveness[:MaxLiveness]
	}
	var live [][]byte
	for _, l := range in.Liveness {
		b, ok := decodeImage(l, MaxLivenessBytes)
		if !ok {
			return Check{}, ErrBadImage
		}
		live = append(live, b)
	}
	if s.Provider == nil {
		return Check{}, ErrUnavailable
	}

	// A check that never reached the provider (the api stopped mid-way)
	// mustn't block the rep for good.
	if _, err := s.DB.Exec(ctx, `DELETE FROM verifications WHERE user_id = $1 AND status = 'pending' AND provider_ref IS NULL AND created_at < $2`,
		u.ID, s.now().Add(-10*time.Minute)); err != nil {
		return Check{}, fmt.Errorf("clear unsent check: %w", err)
	}
	var verified bool
	var tries int
	if err := s.DB.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM verifications WHERE user_id = $1 AND status = 'approved'),
		       (SELECT count(*) FROM verifications WHERE user_id = $1 AND created_at > $2)`,
		u.ID, s.now().Add(-24*time.Hour)).Scan(&verified, &tries); err != nil {
		return Check{}, fmt.Errorf("read checks: %w", err)
	}
	if verified {
		return Check{}, ErrAlreadyVerified
	}
	if tries >= TriesPerDay {
		return Check{}, ErrTooManyTries
	}
	var id string
	err := s.DB.QueryRow(ctx, `INSERT INTO verifications (user_id, id_type, country, status, created_at) VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
		u.ID, in.IDType, in.Country, s.now()).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return Check{}, ErrPending
	}
	if err != nil {
		return Check{}, fmt.Errorf("record check: %w", err)
	}

	ref, err := s.Provider.Submit(ctx, Job{ID: id, UserID: u.ID, Country: in.Country, IDImage: idImage, Selfie: selfie, Liveness: live})
	if err != nil {
		s.log().ErrorContext(ctx, "submit id check", "user_id", u.ID, "err", err)
		// Not sent, so it doesn't count as a try or block the next one.
		if _, derr := s.DB.Exec(context.WithoutCancel(ctx), `DELETE FROM verifications WHERE id = $1`, id); derr != nil {
			s.log().ErrorContext(ctx, "drop unsent check", "id", id, "err", derr)
		}
		return Check{}, ErrUnavailable
	}
	c, err := scanCheck(s.DB.QueryRow(ctx, `UPDATE verifications SET provider_ref = $2 WHERE id = $1 RETURNING `+checkCols, id, ref))
	if err != nil {
		return Check{}, fmt.Errorf("save provider ref: %w", err)
	}
	return c, nil
}

// HandleCallback is the provider saying a job has a result. The callback
// only names the job; the result is read from the provider.
func (s *Service) HandleCallback(ctx context.Context, body []byte) error {
	if s.Provider == nil {
		return ErrUnavailable
	}
	userID, jobID, err := s.Provider.ParseCallback(body)
	if err != nil {
		return err
	}
	var known bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM verifications WHERE id::text = $1 AND user_id::text = $2)`, jobID, userID).Scan(&known); err != nil {
		return fmt.Errorf("find check: %w", err)
	}
	if !known {
		s.log().WarnContext(ctx, "callback for an unknown id check", "job_id", jobID)
		return nil
	}
	return s.Refresh(ctx, jobID)
}

// Refresh asks the provider about a pending check and records the result.
func (s *Service) Refresh(ctx context.Context, id string) error {
	if s.Provider == nil {
		return ErrUnavailable
	}
	var userID, name, email string
	var status string
	var review bool
	err := s.DB.QueryRow(ctx, `
		SELECT v.user_id, v.status, v.needs_review, u.name, u.email FROM verifications v JOIN users u ON u.id = v.user_id WHERE v.id::text = $1`,
		id).Scan(&userID, &status, &review, &name, &email)
	if err != nil {
		return fmt.Errorf("read check: %w", err)
	}
	if status != string(Pending) || review {
		return nil
	}
	res, err := s.Provider.Result(ctx, userID, id)
	if err != nil {
		return err
	}
	if _, err := s.DB.Exec(ctx, `UPDATE verifications SET checked_at = $2 WHERE id = $1`, id, s.now()); err != nil {
		return fmt.Errorf("mark checked: %w", err)
	}
	if !res.Done {
		return nil
	}

	newStatus, needsReview := Failed, false
	reason := res.Reason
	if res.Outcome == Approved {
		newStatus = Verified
		if !NameMatches(name, res.NameOnID) {
			newStatus, needsReview = Pending, true
			reason = "The name on the ID doesn't match the account name."
		}
	}
	tag, err := s.DB.Exec(ctx, `
		UPDATE verifications SET status = $2, needs_review = $3, reason = $4, name_on_id = NULLIF($5, ''), result_at = $6
		WHERE id = $1 AND status = 'pending' AND NOT needs_review`,
		id, string(newStatus), needsReview, reason, res.NameOnID, s.now())
	if err != nil {
		return fmt.Errorf("save result: %w", err)
	}
	if tag.RowsAffected() == 1 {
		s.tell(ctx, email, name, newStatus, needsReview)
	}
	return nil
}

func (s *Service) tell(ctx context.Context, email, name string, st Status, review bool) {
	if s.Mail == nil {
		return
	}
	first := strings.Fields(name)
	hi := "Hi,"
	if len(first) > 0 {
		hi = "Hi " + first[0] + ","
	}
	m := notify.Email{To: email}
	switch {
	case review:
		m.Subject = "We're checking your ID by hand"
		m.Text = hi + "\n\nThe name on your ID doesn't match the name on your account, so a person will check it. This usually takes a working day.\n\nDialer"
	case st == Verified:
		m.Subject = "Your ID is verified"
		m.Text = hi + "\n\nYour ID check passed. Your new-account limits are gone, and on Starter you can now make 500 dials a day.\n\nDialer"
	default:
		m.Subject = "We couldn't verify your ID"
		m.Text = hi + "\n\nYour ID check didn't pass. Try again with a sharp photo that shows all four corners of the ID, in good light, and make sure your face is clear in the face check.\n\nDialer"
	}
	if err := s.Mail.SendEmail(ctx, m); err != nil {
		s.log().ErrorContext(ctx, "id check email", "err", err)
	}
}

// CheckPending asks the provider about checks whose callback hasn't come,
// in case it was lost. The worker runs it.
func (s *Service) CheckPending(ctx context.Context) (int, error) {
	now := s.now()
	rows, err := s.DB.Query(ctx, `
		SELECT id::text FROM verifications
		WHERE status = 'pending' AND NOT needs_review AND provider_ref IS NOT NULL
		  AND created_at < $1 AND (checked_at IS NULL OR checked_at < $2)
		ORDER BY created_at LIMIT 50`, now.Add(-2*time.Minute), now.Add(-5*time.Minute))
	if err != nil {
		return 0, fmt.Errorf("find pending checks: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, fmt.Errorf("find pending checks: %w", err)
	}
	for _, id := range ids {
		if err := s.Refresh(ctx, id); err != nil {
			s.log().ErrorContext(ctx, "refresh id check", "id", id, "err", err)
		}
	}
	return len(ids), nil
}

// NameMatches says whether the name on an ID covers the account name: each
// word of the account name (ignoring case, accents aside) appears on the ID.
// An ID that gives no name matches; the provider already compared the face.
func NameMatches(account, onID string) bool {
	if strings.TrimSpace(onID) == "" {
		return true
	}
	words := func(s string) []string {
		return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) })
	}
	have := map[string]bool{}
	for _, w := range words(onID) {
		have[w] = true
	}
	want := words(account)
	if len(want) == 0 {
		return false
	}
	for _, w := range want {
		if !have[w] {
			return false
		}
	}
	return true
}
