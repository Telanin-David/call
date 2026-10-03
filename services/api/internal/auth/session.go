package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/platform"
)

// CookieName is the session cookie. It holds a random token; the database
// stores only its hash.
const CookieName = "dialer_session"

// SessionTTL is how long a sign-in lasts.
const SessionTTL = 30 * 24 * time.Hour

// ErrNoSession means the request has no valid session.
var ErrNoSession = errors.New("auth: not signed in")

// User is the signed-in rep, as every handler sees them.
type User struct {
	ID              string
	Name            string
	Email           string
	Phone           string
	Country         string
	Timezone        string
	Status          string
	EmailConfirmed  bool
	PhoneConfirmed  bool
	RulesAcceptedAt *time.Time
	CreatedAt       time.Time
}

// Confirmed is true once both email and phone are confirmed.
func (u User) Confirmed() bool { return u.EmailConfirmed && u.PhoneConfirmed }

// UserCols and ScanUser read a users row into a User.
const UserCols = `id, name, email, phone, country, timezone, status, email_confirmed, phone_confirmed, rules_accepted_at, created_at`

func ScanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Name, &u.Email, &u.Phone, &u.Country, &u.Timezone, &u.Status,
		&u.EmailConfirmed, &u.PhoneConfirmed, &u.RulesAcceptedAt, &u.CreatedAt)
	return u, err
}

// Sessions creates, finds and ends sign-in sessions.
type Sessions struct {
	DB     *pgxpool.Pool
	Hasher Hasher
	// Secure marks the cookie HTTPS-only. Off only for local development.
	Secure bool
}

// Create starts a session for userID and returns the cookie token.
func (s Sessions) Create(ctx context.Context, q platform.Querier, userID, device string) (string, time.Time, error) {
	token, err := NewToken()
	if err != nil {
		return "", time.Time{}, err
	}
	expires := time.Now().Add(SessionTTL)
	_, err = q.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, device, expires_at) VALUES ($1, $2, NULLIF($3, ''), $4)`,
		userID, s.Hasher.Hash(token), truncate(device, 200), expires)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create session: %w", err)
	}
	return token, expires, nil
}

// Lookup returns the user for a session token. Expired sessions and
// suspended accounts count as signed out.
func (s Sessions) Lookup(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrNoSession
	}
	u, err := ScanUser(s.DB.QueryRow(ctx, `
		SELECT u.`+prefixed(UserCols)+`
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status <> 'suspended'`,
		s.Hasher.Hash(token)))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNoSession
	}
	if err != nil {
		return User{}, fmt.Errorf("look up session: %w", err)
	}
	return u, nil
}

// Delete ends one session.
func (s Sessions) Delete(ctx context.Context, token string) error {
	if _, err := s.DB.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, s.Hasher.Hash(token)); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// DeleteAll signs a user out everywhere (after a password reset).
func DeleteAll(ctx context.Context, q platform.Querier, userID string) error {
	if _, err := q.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	return nil
}

// SetCookie sends the session cookie.
func (s Sessions) SetCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: token, Path: "/", Expires: expires,
		HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteLaxMode,
	})
}

// ClearCookie removes the session cookie.
func (s Sessions) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.Secure, SameSite: http.SameSiteLaxMode,
	})
}

// Token reads the session token from a request.
func Token(r *http.Request) string {
	c, err := r.Cookie(CookieName)
	if err != nil {
		return ""
	}
	return c.Value
}

type ctxKey struct{}

// WithUser returns a context carrying the signed-in user.
func WithUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

// UserFrom returns the signed-in user, if any.
func UserFrom(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(ctxKey{}).(User)
	return u, ok
}

// Load puts the signed-in user, if there is one, on the request context.
func (s Sessions) Load(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, err := s.Lookup(r.Context(), Token(r))
		switch {
		case err == nil:
			r = r.WithContext(WithUser(r.Context(), u))
		case !errors.Is(err, ErrNoSession):
			platform.ErrorJSON(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireUser rejects requests with no session.
func RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := UserFrom(r.Context()); !ok {
			platform.ErrorJSON(w, http.StatusUnauthorized, "signed_out", "Sign in to carry on.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireConfirmed rejects requests until email and phone are confirmed.
func RequireConfirmed(next http.Handler) http.Handler {
	return RequireUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, _ := UserFrom(r.Context()); !u.Confirmed() {
			platform.ErrorJSON(w, http.StatusForbidden, "not_confirmed", "Confirm your email and phone first.")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

// prefixed qualifies each column with the users table alias.
func prefixed(cols string) string {
	return strings.ReplaceAll(cols, ", ", ", u.")
}

// truncate cuts s to at most n bytes without splitting a character.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
