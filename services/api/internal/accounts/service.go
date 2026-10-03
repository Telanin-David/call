// Package accounts runs the account flows: sign up, confirm email and
// phone, sign in and out, forgotten password, profile and settings.
package accounts

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// How long codes work, how often they can be sent, and how many wrong tries
// a code survives.
const (
	emailLinkTTL     = 24 * time.Hour
	phoneCodeTTL     = 10 * time.Minute
	resetCodeTTL     = 10 * time.Minute
	resendGap        = 60 * time.Second
	sendsPerHour     = 5
	maxCodeAttempts  = 5
	limitWindow      = 15 * time.Minute
	signinsPerLogin  = 10
	signinsPerIP     = 50
	signupsPerIPHour = 5
	forgotsPerIPHour = 10
	resetsPerLogin   = 10
)

type purpose string

const (
	purposeEmail purpose = "email_confirm"
	purposePhone purpose = "phone_confirm"
	purposeReset purpose = "password_reset"
)

// Service holds what the flows need. Every outside service sits behind an
// interface so tests run with fakes.
type Service struct {
	DB       *pgxpool.Pool
	Sessions auth.Sessions
	Hasher   auth.Hasher
	Mail     notify.Mailer
	Text     notify.Texter
	Limiter  platform.Limiter
	// WebURL is where the web app lives, for links in emails.
	WebURL string
	Log    *slog.Logger
}

// Session is a new sign-in to hand back as a cookie.
type Session struct {
	Token   string
	Expires time.Time
}

// SignupInput is what the sign-up form sends.
type SignupInput struct {
	Name        string
	Email       string
	Phone       string
	Password    string
	Country     string
	Timezone    string
	AcceptRules bool
	IP          string
	Device      string
}

// Signup creates an account, signs the rep in, and sends the email link and
// the phone code. Sending happens after the account is saved: if a provider
// is down the rep can ask for a new code from the confirm screen.
func (s *Service) Signup(ctx context.Context, in SignupInput) (auth.User, Session, error) {
	name, ok := NormalizeName(in.Name)
	if !ok {
		return auth.User{}, Session{}, invalid("name", "Enter your full name as it is on your ID.")
	}
	email, ok := NormalizeEmail(in.Email)
	if !ok {
		return auth.User{}, Session{}, invalid("email", "Enter a valid email address.")
	}
	phone, ok := NormalizePhone(in.Phone)
	if !ok {
		return auth.User{}, Session{}, invalid("phone", "Enter your phone number with the country code, like +234 803 123 4567.")
	}
	if err := auth.CheckPasswordRules(in.Password); err != nil {
		return auth.User{}, Session{}, invalid("password", fmt.Sprintf("Use at least %d characters for your password.", auth.MinPasswordLen))
	}
	country, ok := NormalizeCountry(in.Country)
	if !ok {
		return auth.User{}, Session{}, invalid("country", "Pick your country.")
	}
	tz := in.Timezone
	if tz == "" {
		tz = "UTC"
	}
	if !ValidTimezone(tz) {
		return auth.User{}, Session{}, invalid("timezone", "Pick your time zone.")
	}
	if !in.AcceptRules {
		return auth.User{}, Session{}, ErrRulesRequired
	}
	if err := s.allow(ctx, "signup:ip:"+in.IP, signupsPerIPHour, time.Hour); err != nil {
		return auth.User{}, Session{}, err
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return auth.User{}, Session{}, err
	}

	var u auth.User
	var sess Session
	var link, code string
	err = platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var err error
		u, err = auth.ScanUser(tx.QueryRow(ctx, `
			INSERT INTO users (name, email, phone, password_hash, country, timezone, rules_accepted_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
			RETURNING `+auth.UserCols, name, email, phone, hash, country, tz))
		if err != nil {
			return takenOr(err)
		}
		if link, err = s.newCode(ctx, tx, u.ID, purposeEmail, "email"); err != nil {
			return err
		}
		if code, err = s.newCode(ctx, tx, u.ID, purposePhone, "sms"); err != nil {
			return err
		}
		sess.Token, sess.Expires, err = s.Sessions.Create(ctx, tx, u.ID, in.Device)
		return err
	})
	if err != nil {
		return auth.User{}, Session{}, err
	}
	s.sendEmailLink(ctx, u, link)
	s.sendPhoneCode(ctx, u.Phone, code, notify.SMS)
	return u, sess, nil
}

// takenOr maps a unique-index clash to "email taken" or "phone taken".
func takenOr(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		switch {
		case strings.Contains(pg.ConstraintName, "email"):
			return ErrEmailTaken
		case strings.Contains(pg.ConstraintName, "phone"):
			return ErrPhoneTaken
		}
	}
	return fmt.Errorf("insert user: %w", err)
}

// ConfirmEmail is called when the rep opens the link in their email. It
// needs no session: the link may be opened on another device.
func (s *Service) ConfirmEmail(ctx context.Context, token string) error {
	if token == "" {
		return ErrLinkInvalid
	}
	return platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var id, userID string
		var expires time.Time
		var used *time.Time
		err := tx.QueryRow(ctx, `
			SELECT id, user_id, expires_at, used_at FROM auth_codes
			WHERE purpose = 'email_confirm' AND code_hash = $1 FOR UPDATE`,
			s.Hasher.Hash(token)).Scan(&id, &userID, &expires, &used)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLinkInvalid
		}
		if err != nil {
			return fmt.Errorf("read email link: %w", err)
		}
		if used != nil {
			// Opening the same link twice is fine once the email is confirmed.
			var confirmed bool
			if err := tx.QueryRow(ctx, `SELECT email_confirmed FROM users WHERE id = $1`, userID).Scan(&confirmed); err != nil {
				return fmt.Errorf("read user: %w", err)
			}
			if confirmed {
				return nil
			}
			return ErrLinkExpired
		}
		if !time.Now().Before(expires) {
			return ErrLinkExpired
		}
		if _, err := tx.Exec(ctx, `UPDATE auth_codes SET used_at = NOW() WHERE id = $1`, id); err != nil {
			return fmt.Errorf("use email link: %w", err)
		}
		return confirm(ctx, tx, userID, "email_confirmed")
	})
}

// ConfirmPhone checks the 6-digit code sent to the rep's phone.
func (s *Service) ConfirmPhone(ctx context.Context, u auth.User, code string) error {
	if u.PhoneConfirmed {
		return nil
	}
	return s.useCode(ctx, u.ID, purposePhone, code, func(tx pgx.Tx) error {
		return confirm(ctx, tx, u.ID, "phone_confirmed")
	})
}

// confirm sets one confirmed flag, and makes the account active once both are set.
func confirm(ctx context.Context, tx pgx.Tx, userID, column string) error {
	_, err := tx.Exec(ctx, `
		UPDATE users SET `+column+` = true,
			status = CASE WHEN status = 'pending' AND (email_confirmed OR $2) AND (phone_confirmed OR $3) THEN 'active' ELSE status END,
			updated_at = NOW()
		WHERE id = $1`, userID, column == "email_confirmed", column == "phone_confirmed")
	if err != nil {
		return fmt.Errorf("confirm %s: %w", column, err)
	}
	return nil
}

// Resend sends a new email link (channel "email") or phone code ("sms" or
// "whatsapp"). Nothing is sent for something already confirmed.
func (s *Service) Resend(ctx context.Context, u auth.User, channel string) error {
	switch channel {
	case "email":
		if u.EmailConfirmed {
			return nil
		}
		link, err := s.newThrottledCode(ctx, u.ID, purposeEmail, channel)
		if err != nil {
			return err
		}
		s.sendEmailLink(ctx, u, link)
		return nil
	case "sms", "whatsapp":
		if u.PhoneConfirmed {
			return nil
		}
		code, err := s.newThrottledCode(ctx, u.ID, purposePhone, channel)
		if err != nil {
			return err
		}
		s.sendPhoneCode(ctx, u.Phone, code, notify.Channel(channel))
		return nil
	}
	return invalid("channel", "Pick email, SMS or WhatsApp.")
}

// Signin checks a password. login is an email or a phone number.
func (s *Service) Signin(ctx context.Context, login, password, ip, device string) (auth.User, Session, error) {
	if err := s.allow(ctx, "signin:ip:"+ip, signinsPerIP, limitWindow); err != nil {
		return auth.User{}, Session{}, err
	}
	key, ok := loginKey(login)
	if !ok {
		auth.BurnPasswordCheck(password)
		return auth.User{}, Session{}, ErrBadLogin
	}
	if err := s.allow(ctx, "signin:login:"+key, signinsPerLogin, limitWindow); err != nil {
		return auth.User{}, Session{}, err
	}
	u, hash, err := s.findByLogin(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		auth.BurnPasswordCheck(password)
		return auth.User{}, Session{}, ErrBadLogin
	}
	if err != nil {
		return auth.User{}, Session{}, err
	}
	match, err := auth.CheckPassword(hash, password)
	if err != nil {
		return auth.User{}, Session{}, fmt.Errorf("check password: %w", err)
	}
	if !match {
		return auth.User{}, Session{}, ErrBadLogin
	}
	if u.Status == "suspended" {
		return auth.User{}, Session{}, ErrSuspended
	}
	var sess Session
	sess.Token, sess.Expires, err = s.Sessions.Create(ctx, s.DB, u.ID, device)
	if err != nil {
		return auth.User{}, Session{}, err
	}
	return u, sess, nil
}

// Signout ends the current session.
func (s *Service) Signout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.Sessions.Delete(ctx, token)
}

// Forgot sends a reset code to the account's phone. It says nothing about
// whether the account exists, so it can't be used to find out who has one.
func (s *Service) Forgot(ctx context.Context, login, ip string) error {
	if err := s.allow(ctx, "forgot:ip:"+ip, forgotsPerIPHour, time.Hour); err != nil {
		return err
	}
	key, ok := loginKey(login)
	if !ok {
		return nil
	}
	u, _, err := s.findByLogin(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && u.Status == "suspended") {
		return nil
	}
	if err != nil {
		return err
	}
	code, err := s.newThrottledCode(ctx, u.ID, purposeReset, "sms")
	if errors.Is(err, ErrSendTooSoon) || errors.Is(err, ErrTooMany) {
		return nil // a code is already on its way
	}
	if err != nil {
		return err
	}
	s.send(ctx, "reset code", s.Text.SendText(ctx, notify.Text{
		To:      u.Phone,
		Channel: notify.SMS,
		Body:    fmt.Sprintf("Your Dialer password reset code is %s. It works for 10 minutes. If you didn't ask for it, ignore this message.", code),
	}))
	return nil
}

// Reset sets a new password with the code from Forgot, and signs the
// account out everywhere.
func (s *Service) Reset(ctx context.Context, login, code, password string) error {
	if err := auth.CheckPasswordRules(password); err != nil {
		return invalid("password", fmt.Sprintf("Use at least %d characters for your password.", auth.MinPasswordLen))
	}
	key, ok := loginKey(login)
	if !ok {
		return ErrCodeWrong
	}
	if err := s.allow(ctx, "reset:login:"+key, resetsPerLogin, limitWindow); err != nil {
		return err
	}
	u, _, err := s.findByLogin(ctx, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrCodeWrong
	}
	if err != nil {
		return err
	}
	return s.useCode(ctx, u.ID, purposeReset, code, func(tx pgx.Tx) error {
		// Hash only once the code is right: wrong codes cost no hashing time.
		hash, err := auth.HashPassword(password)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, u.ID, hash); err != nil {
			return fmt.Errorf("set password: %w", err)
		}
		return auth.DeleteAll(ctx, tx, u.ID)
	})
}

// Me is the signed-in rep's profile, plan and money.
type Me struct {
	auth.User
	Plan    string
	Balance int64 // micro-dollars the rep can spend
	Held    int64 // micro-dollars set aside for running calls
}

func (s *Service) Me(ctx context.Context, u auth.User) (Me, error) {
	m := Me{User: u, Plan: "free"}
	err := s.DB.QueryRow(ctx, `SELECT plan_id FROM subscriptions WHERE user_id = $1`, u.ID).Scan(&m.Plan)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Me{}, fmt.Errorf("read plan: %w", err)
	}
	if m.Balance, err = ledger.Balance(ctx, s.DB, u.ID); err != nil {
		return Me{}, err
	}
	if m.Held, err = ledger.Held(ctx, s.DB, u.ID); err != nil {
		return Me{}, err
	}
	return m, nil
}

// Settings are the fields a rep can change. Nil means "leave as is". The
// name can't change here: it must match the ID and the card.
type Settings struct {
	Timezone *string
	Country  *string
}

func (s *Service) UpdateSettings(ctx context.Context, u auth.User, in Settings) (auth.User, error) {
	tz, country := u.Timezone, u.Country
	if in.Timezone != nil {
		if !ValidTimezone(*in.Timezone) {
			return auth.User{}, invalid("timezone", "Pick your time zone.")
		}
		tz = *in.Timezone
	}
	if in.Country != nil {
		c, ok := NormalizeCountry(*in.Country)
		if !ok {
			return auth.User{}, invalid("country", "Pick your country.")
		}
		country = c
	}
	out, err := auth.ScanUser(s.DB.QueryRow(ctx, `
		UPDATE users SET timezone = $2, country = $3, updated_at = NOW() WHERE id = $1
		RETURNING `+auth.UserCols, u.ID, tz, country))
	if err != nil {
		return auth.User{}, fmt.Errorf("update settings: %w", err)
	}
	return out, nil
}

// loginKey normalises an email or phone number for lookups and rate limits.
func loginKey(login string) (string, bool) {
	if strings.Contains(login, "@") {
		return NormalizeEmail(login)
	}
	return NormalizePhone(login)
}

func (s *Service) findByLogin(ctx context.Context, key string) (auth.User, string, error) {
	col := "phone"
	if strings.Contains(key, "@") {
		col = "lower(email)"
	}
	var u auth.User
	var hash string
	err := s.DB.QueryRow(ctx, `SELECT `+auth.UserCols+`, password_hash FROM users WHERE `+col+` = $1`, key).Scan(
		&u.ID, &u.Name, &u.Email, &u.Phone, &u.Country, &u.Timezone, &u.Status,
		&u.EmailConfirmed, &u.PhoneConfirmed, &u.RulesAcceptedAt, &u.CreatedAt, &hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		err = fmt.Errorf("find user: %w", err)
	}
	return u, hash, err
}

// newCode stores a fresh code (or email token) and retires older ones of
// the same kind. It returns the plain code to send.
func (s *Service) newCode(ctx context.Context, tx pgx.Tx, userID string, p purpose, channel string) (string, error) {
	var code string
	var err error
	ttl := phoneCodeTTL
	switch p {
	case purposeEmail:
		code, err = auth.NewToken()
		ttl = emailLinkTTL
	case purposeReset:
		code, err = auth.NewCode()
		ttl = resetCodeTTL
	default:
		code, err = auth.NewCode()
	}
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE auth_codes SET expires_at = NOW()
		WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()`, userID, string(p)); err != nil {
		return "", fmt.Errorf("retire codes: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO auth_codes (user_id, purpose, channel, code_hash, expires_at)
		VALUES ($1, $2, $3, $4, $5)`,
		userID, string(p), channel, s.Hasher.Hash(code), time.Now().Add(ttl)); err != nil {
		return "", fmt.Errorf("store code: %w", err)
	}
	return code, nil
}

// newThrottledCode is newCode with the send limits: one a minute, five an hour.
func (s *Service) newThrottledCode(ctx context.Context, userID string, p purpose, channel string) (string, error) {
	var code string
	err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		// Serialise sends per user and purpose so two quick taps can't both pass.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('codes:' || $1 || ':' || $2, 0))`, userID, string(p)); err != nil {
			return fmt.Errorf("lock codes: %w", err)
		}
		var lastHour int
		var since *float64
		err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour'),
			       EXTRACT(EPOCH FROM NOW() - MAX(created_at))::float8
			FROM auth_codes WHERE user_id = $1 AND purpose = $2`, userID, string(p)).Scan(&lastHour, &since)
		if err != nil {
			return fmt.Errorf("count codes: %w", err)
		}
		if since != nil && *since < resendGap.Seconds() {
			return sendTooSoon(int(resendGap.Seconds()-*since) + 1)
		}
		if lastHour >= sendsPerHour {
			return ErrTooMany
		}
		code, err = s.newCode(ctx, tx, userID, p, channel)
		return err
	})
	return code, err
}

// useCode checks code against the newest live code of its kind. A wrong
// code counts as a try even though the call fails; after five the code is
// dead. On a match, onMatch runs in the same transaction.
func (s *Service) useCode(ctx context.Context, userID string, p purpose, code string, onMatch func(pgx.Tx) error) error {
	code = strings.TrimSpace(code)
	var result error
	err := platform.InTx(ctx, s.DB, func(tx pgx.Tx) error {
		var id, hash string
		var attempts int
		var expires time.Time
		err := tx.QueryRow(ctx, `
			SELECT id, code_hash, attempts, expires_at FROM auth_codes
			WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL
			ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, userID, string(p)).Scan(&id, &hash, &attempts, &expires)
		if errors.Is(err, pgx.ErrNoRows) {
			result = ErrCodeExpired
			return nil
		}
		if err != nil {
			return fmt.Errorf("read code: %w", err)
		}
		if !time.Now().Before(expires) {
			result = ErrCodeExpired
			return nil
		}
		if attempts >= maxCodeAttempts {
			result = ErrCodeLocked
			return nil
		}
		if !s.Hasher.Equal(code, hash) {
			if _, err := tx.Exec(ctx, `UPDATE auth_codes SET attempts = attempts + 1 WHERE id = $1`, id); err != nil {
				return fmt.Errorf("count try: %w", err)
			}
			result = ErrCodeWrong
			return nil // commit the extra try
		}
		if _, err := tx.Exec(ctx, `UPDATE auth_codes SET used_at = NOW() WHERE id = $1`, id); err != nil {
			return fmt.Errorf("use code: %w", err)
		}
		return onMatch(tx)
	})
	if err != nil {
		return err
	}
	return result
}

func (s *Service) allow(ctx context.Context, key string, limit int, window time.Duration) error {
	ok, err := s.Limiter.Allow(ctx, key, limit, window)
	if err != nil {
		return err
	}
	if !ok {
		return ErrTooMany
	}
	return nil
}

func (s *Service) sendEmailLink(ctx context.Context, u auth.User, token string) {
	link := strings.TrimRight(s.WebURL, "/") + "/confirm-email?token=" + url.QueryEscape(token)
	s.send(ctx, "email link", s.Mail.SendEmail(ctx, notify.Email{
		To:      u.Email,
		Subject: "Confirm your email for Dialer",
		Text: fmt.Sprintf("Hi %s,\n\nOpen this link to confirm your email:\n%s\n\nThe link works for 24 hours. If you didn't sign up for Dialer, ignore this email.\n",
			firstName(u.Name), link),
	}))
}

func (s *Service) sendPhoneCode(ctx context.Context, phone, code string, ch notify.Channel) {
	s.send(ctx, "phone code", s.Text.SendText(ctx, notify.Text{
		To:      phone,
		Channel: ch,
		Body:    fmt.Sprintf("Your Dialer code is %s. It works for 10 minutes. Don't share it with anyone.", code),
	}))
}

// send logs a failed send. The flow carries on: the rep can ask again.
func (s *Service) send(ctx context.Context, what string, err error) {
	if err != nil && s.Log != nil {
		s.Log.ErrorContext(ctx, "send failed", "what", what, "err", err)
	}
}

func firstName(name string) string {
	if f := strings.Fields(name); len(f) > 0 {
		return f[0]
	}
	return name
}
