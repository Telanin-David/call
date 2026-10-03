package accounts

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// Routes mounts the account endpoints. The router must already run
// Sessions.Load so handlers can see who is signed in.
func (s *Service) Routes(r chi.Router) {
	r.Post("/auth/signup", s.handleSignup)
	r.Post("/auth/signin", s.handleSignin)
	r.Post("/auth/signout", s.handleSignout)
	r.Post("/auth/confirm/email", s.handleConfirmEmail)
	r.Post("/auth/forgot", s.handleForgot)
	r.Post("/auth/reset", s.handleReset)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireUser)
		r.Post("/auth/confirm/phone", s.handleConfirmPhone)
		r.Post("/auth/resend", s.handleResend)
		r.Get("/me", s.handleMe)
		r.Patch("/me/settings", s.handleSettings)
	})
}

// UserJSON is the account as the web app sees it. Money is in
// micro-dollars, never a float.
type UserJSON struct {
	ID              string     `json:"user_id"`
	Name            string     `json:"name"`
	Email           string     `json:"email"`
	Phone           string     `json:"phone"`
	Country         string     `json:"country"`
	Timezone        string     `json:"timezone"`
	EmailConfirmed  bool       `json:"email_confirmed"`
	PhoneConfirmed  bool       `json:"phone_confirmed"`
	Confirmed       bool       `json:"confirmed"`
	RulesAcceptedAt *time.Time `json:"rules_accepted_at"`
	CreatedAt       time.Time  `json:"created_at"`
}

func userJSON(u auth.User) UserJSON {
	return UserJSON{
		ID: u.ID, Name: u.Name, Email: u.Email, Phone: u.Phone, Country: u.Country, Timezone: u.Timezone,
		EmailConfirmed: u.EmailConfirmed, PhoneConfirmed: u.PhoneConfirmed, Confirmed: u.Confirmed(),
		RulesAcceptedAt: u.RulesAcceptedAt, CreatedAt: u.CreatedAt,
	}
}

type meJSON struct {
	UserJSON
	Plan                string `json:"plan"`
	BalanceMicrodollars int64  `json:"balance_microdollars"`
	HeldMicrodollars    int64  `json:"held_microdollars"`
}

func (s *Service) handleSignup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		Email       string `json:"email"`
		Phone       string `json:"phone"`
		Password    string `json:"password"`
		Country     string `json:"country"`
		Timezone    string `json:"timezone"`
		AcceptRules bool   `json:"accept_rules"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, sess, err := s.Signup(r.Context(), SignupInput{
		Name: in.Name, Email: in.Email, Phone: in.Phone, Password: in.Password,
		Country: in.Country, Timezone: in.Timezone, AcceptRules: in.AcceptRules,
		IP: clientIP(r), Device: r.UserAgent(),
	})
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Sessions.SetCookie(w, sess.Token, sess.Expires)
	platform.JSON(w, http.StatusCreated, userJSON(u))
}

func (s *Service) handleSignin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, sess, err := s.Signin(r.Context(), in.Login, in.Password, clientIP(r), r.UserAgent())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.Sessions.SetCookie(w, sess.Token, sess.Expires)
	platform.JSON(w, http.StatusOK, userJSON(u))
}

func (s *Service) handleSignout(w http.ResponseWriter, r *http.Request) {
	if err := s.Signout(r.Context(), auth.Token(r)); err != nil {
		s.fail(w, r, err)
		return
	}
	s.Sessions.ClearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleConfirmEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.ConfirmEmail(r.Context(), in.Token); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleConfirmPhone(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	if err := s.ConfirmPhone(r.Context(), u, in.Code); err != nil {
		s.fail(w, r, err)
		return
	}
	s.respondMe(w, r, u.ID)
}

func (s *Service) handleResend(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Channel string `json:"channel"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	if err := s.Resend(r.Context(), u, in.Channel); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleForgot(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Login string `json:"login"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.Forgot(r.Context(), in.Login, clientIP(r)); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleReset(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Login    string `json:"login"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.Reset(r.Context(), in.Login, in.Code, in.Password); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	s.respondMe(w, r, u.ID)
}

func (s *Service) handleSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Timezone *string `json:"timezone"`
		Country  *string `json:"country"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	if _, err := s.UpdateSettings(r.Context(), u, Settings{Timezone: in.Timezone, Country: in.Country}); err != nil {
		s.fail(w, r, err)
		return
	}
	s.respondMe(w, r, u.ID)
}

// respondMe re-reads the user, so the answer shows changes just made.
func (s *Service) respondMe(w http.ResponseWriter, r *http.Request, userID string) {
	u, err := auth.ScanUser(s.DB.QueryRow(r.Context(), `SELECT `+auth.UserCols+` FROM users WHERE id = $1`, userID))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	m, err := s.Me(r.Context(), u)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, meJSON{UserJSON: userJSON(m.User), Plan: m.Plan, BalanceMicrodollars: m.Balance, HeldMicrodollars: m.Held})
}

// fail answers with the rep-facing message, or a plain 500 for anything
// unexpected (logged, never shown).
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if errors.As(err, &e) {
		if e.RetryAfter > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(e.RetryAfter))
		}
		platform.ErrorJSON(w, e.Status, e.Code, e.Message)
		return
	}
	if s.Log != nil {
		s.Log.ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "err", err)
	} else {
		slog.ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "err", err)
	}
	platform.ErrorJSON(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
}

// decode reads a small JSON body. It answers 400 itself when the body is bad.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(v)
	if err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return false
	}
	return true
}

// clientIP is the caller's address without the port. RealIP middleware has
// already applied X-Forwarded-For from the proxy in front of the api.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
