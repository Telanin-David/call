package accounts_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/telanin-david/call/services/api/internal/accounts"
	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

type env struct {
	t      *testing.T
	db     *pgxpool.Pool
	svc    *accounts.Service
	sent   *notify.Fake
	server *httptest.Server
}

func newEnv(t *testing.T) *env {
	t.Helper()
	db := testdb.Pool(t)
	hasher := auth.NewHasher("test-key")
	sent := &notify.Fake{}
	svc := &accounts.Service{
		DB: db, Sessions: auth.Sessions{DB: db, Hasher: hasher}, Hasher: hasher,
		Mail: sent, Text: sent, Limiter: platform.NewMemoryLimiter(), WebURL: "https://app.dialer.test",
	}
	r := chi.NewRouter()
	r.Use(platform.RequireJSON)
	r.Use(svc.Sessions.Load)
	svc.Routes(r)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return &env{t: t, db: db, svc: svc, sent: sent, server: srv}
}

// client is one browser: it keeps its own cookies.
type client struct {
	e    *env
	http *http.Client
}

func (e *env) client() *client {
	jar, _ := cookiejar.New(nil)
	return &client{e: e, http: &http.Client{Jar: jar}}
}

type reply struct {
	Status int
	Header http.Header
	Body   map[string]any
}

func (r reply) code() string { s, _ := r.Body["code"].(string); return s }

func (c *client) do(method, path string, body any) reply {
	c.e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, c.e.server.URL+path, &buf)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer resp.Body.Close()
	out := reply{Status: resp.StatusCode, Header: resp.Header, Body: map[string]any{}}
	_ = json.NewDecoder(resp.Body).Decode(&out.Body)
	return out
}

func (c *client) post(path string, body any) reply { return c.do(http.MethodPost, path, body) }

func (c *client) expect(r reply, status int, code string) {
	c.e.t.Helper()
	if r.Status != status || r.code() != code {
		c.e.t.Fatalf("got %d %q (%v), want %d %q", r.Status, r.code(), r.Body, status, code)
	}
}

var (
	codeRe  = regexp.MustCompile(`\b(\d{6})\b`)
	tokenRe = regexp.MustCompile(`token=([^\s]+)`)
)

func (e *env) lastCode(phone string) string {
	e.t.Helper()
	m, ok := e.sent.LastText(phone)
	if !ok {
		e.t.Fatalf("no text sent to %s", phone)
	}
	return codeRe.FindStringSubmatch(m.Body)[1]
}

func (e *env) lastLinkToken(email string) string {
	e.t.Helper()
	m, ok := e.sent.LastEmail(email)
	if !ok {
		e.t.Fatalf("no email sent to %s", email)
	}
	tok, err := url.QueryUnescape(tokenRe.FindStringSubmatch(m.Text)[1])
	if err != nil {
		e.t.Fatal(err)
	}
	return tok
}

type person struct{ name, email, phone, password string }

var n int

func newPerson() person {
	n++
	p := testdb.Phone()
	return person{name: "Ada Obi", email: fmt.Sprintf("ada.%s.%d@example.test", strings.TrimPrefix(p, "+"), n), phone: p, password: "correct-horse"}
}

func (p person) signup() map[string]any {
	return map[string]any{"name": p.name, "email": p.email, "phone": p.phone, "password": p.password, "country": "ng", "timezone": "Africa/Lagos", "accept_rules": true}
}

// The whole life of an account through the HTTP endpoints.
func TestAccountJourney(t *testing.T) {
	e := newEnv(t)
	p := newPerson()
	laptop := e.client()

	r := laptop.post("/auth/signup", p.signup())
	laptop.expect(r, http.StatusCreated, "")
	if r.Body["confirmed"] != false || r.Body["country"] != "NG" || r.Body["rules_accepted_at"] == nil {
		t.Fatalf("signup body = %v", r.Body)
	}

	me := laptop.do(http.MethodGet, "/me", nil)
	laptop.expect(me, http.StatusOK, "")
	if me.Body["plan"] != "free" || me.Body["balance_microdollars"] != float64(0) {
		t.Fatalf("me = %v", me.Body)
	}

	// Phone: a wrong code first, then the right one.
	laptop.expect(laptop.post("/auth/confirm/phone", map[string]string{"code": "000000x"}), http.StatusUnprocessableEntity, "code_wrong")
	r = laptop.post("/auth/confirm/phone", map[string]string{"code": e.lastCode(p.phone)})
	laptop.expect(r, http.StatusOK, "")
	if r.Body["phone_confirmed"] != true || r.Body["confirmed"] != false {
		t.Fatalf("after phone code = %v", r.Body)
	}

	// Email: the link is opened on another device, with no session.
	phone := e.client()
	token := e.lastLinkToken(p.email)
	phone.expect(phone.post("/auth/confirm/email", map[string]string{"token": token}), http.StatusNoContent, "")
	phone.expect(phone.post("/auth/confirm/email", map[string]string{"token": token}), http.StatusNoContent, "") // opened twice
	phone.expect(phone.post("/auth/confirm/email", map[string]string{"token": "made-up"}), http.StatusUnprocessableEntity, "link_invalid")

	me = laptop.do(http.MethodGet, "/me", nil)
	if me.Body["confirmed"] != true {
		t.Fatalf("me after confirming = %v", me.Body)
	}
	var status string
	_ = e.db.QueryRow(context.Background(), `SELECT status FROM users WHERE email = $1`, p.email).Scan(&status)
	if status != "active" {
		t.Fatalf("status = %q, want active", status)
	}

	// Sign out, then back in by phone number written another way.
	laptop.expect(laptop.post("/auth/signout", nil), http.StatusNoContent, "")
	laptop.expect(laptop.do(http.MethodGet, "/me", nil), http.StatusUnauthorized, "signed_out")
	spaced := p.phone[:2] + " " + p.phone[2:5] + "-" + p.phone[5:]
	laptop.expect(laptop.post("/auth/signin", map[string]string{"login": spaced, "password": "wrong-password"}), http.StatusUnauthorized, "bad_login")
	laptop.expect(laptop.post("/auth/signin", map[string]string{"login": spaced, "password": p.password}), http.StatusOK, "")
	other := e.client()
	other.expect(other.post("/auth/signin", map[string]string{"login": strings.ToUpper(p.email), "password": p.password}), http.StatusOK, "")

	// Forgot password: a code by SMS, then a new password signs out everywhere.
	stranger := e.client()
	stranger.expect(stranger.post("/auth/forgot", map[string]string{"login": p.email}), http.StatusNoContent, "")
	reset := e.lastCode(p.phone)
	stranger.expect(stranger.post("/auth/reset", map[string]string{"login": p.email, "code": reset, "password": "short"}), http.StatusUnprocessableEntity, "invalid_password")
	stranger.expect(stranger.post("/auth/reset", map[string]string{"login": p.email, "code": "999999x", "password": "new-password-1"}), http.StatusUnprocessableEntity, "code_wrong")
	stranger.expect(stranger.post("/auth/reset", map[string]string{"login": p.email, "code": reset, "password": "new-password-1"}), http.StatusNoContent, "")
	stranger.expect(stranger.post("/auth/reset", map[string]string{"login": p.email, "code": reset, "password": "new-password-2"}), http.StatusUnprocessableEntity, "code_expired")

	laptop.expect(laptop.do(http.MethodGet, "/me", nil), http.StatusUnauthorized, "signed_out")
	other.expect(other.do(http.MethodGet, "/me", nil), http.StatusUnauthorized, "signed_out")
	laptop.expect(laptop.post("/auth/signin", map[string]string{"login": p.email, "password": p.password}), http.StatusUnauthorized, "bad_login")
	laptop.expect(laptop.post("/auth/signin", map[string]string{"login": p.email, "password": "new-password-1"}), http.StatusOK, "")

	// Settings.
	r = laptop.do(http.MethodPatch, "/me/settings", map[string]string{"timezone": "America/New_York"})
	laptop.expect(r, http.StatusOK, "")
	if r.Body["timezone"] != "America/New_York" || r.Body["country"] != "NG" {
		t.Fatalf("settings = %v", r.Body)
	}
	laptop.expect(laptop.do(http.MethodPatch, "/me/settings", map[string]string{"timezone": "Mars/Base"}), http.StatusUnprocessableEntity, "invalid_timezone")
}

func TestSignupChecks(t *testing.T) {
	e := newEnv(t)
	taken := newPerson()
	c := e.client()
	c.expect(c.post("/auth/signup", taken.signup()), http.StatusCreated, "")

	tests := []struct {
		name   string
		change func(map[string]any)
		status int
		code   string
	}{
		{"one-letter name", func(m map[string]any) { m["name"] = "A" }, 422, "invalid_name"},
		{"bad email", func(m map[string]any) { m["email"] = "ada@nowhere" }, 422, "invalid_email"},
		{"phone with no country code", func(m map[string]any) { m["phone"] = "0803 123 4567" }, 422, "invalid_phone"},
		{"phone with letters", func(m map[string]any) { m["phone"] = "+234803CALLME" }, 422, "invalid_phone"},
		{"9-character password", func(m map[string]any) { m["password"] = "123456789" }, 422, "invalid_password"},
		{"bad country", func(m map[string]any) { m["country"] = "Nigeria" }, 422, "invalid_country"},
		{"bad time zone", func(m map[string]any) { m["timezone"] = "Lagos" }, 422, "invalid_timezone"},
		{"rules not accepted", func(m map[string]any) { m["accept_rules"] = false }, 422, "rules_required"},
		{"email taken, any case", func(m map[string]any) { m["email"] = strings.ToUpper(taken.email) }, 409, "email_taken"},
		{"phone taken", func(m map[string]any) { m["phone"] = taken.phone }, 409, "phone_taken"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := newPerson().signup()
			tt.change(body)
			c := e.client()
			c.expect(c.post("/auth/signup", body), tt.status, tt.code)
		})
	}
}

func TestSignupLimits(t *testing.T) {
	t.Run("a whole office can sign up from one connection", func(t *testing.T) {
		e := newEnv(t)
		for i := 0; i < 12; i++ {
			c := e.client()
			c.expect(c.post("/auth/signup", newPerson().signup()), http.StatusCreated, "")
		}
	})

	tests := []struct {
		name  string
		reuse func(first, next map[string]any)
		code  string // what tries 2 to 5 get
	}{
		{"same email, five tries an hour", func(first, next map[string]any) { next["email"] = first["email"] }, "email_taken"},
		{"same phone, five tries an hour", func(first, next map[string]any) { next["phone"] = first["phone"] }, "phone_taken"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := newEnv(t)
			c := e.client()
			first := newPerson().signup()
			c.expect(c.post("/auth/signup", first), http.StatusCreated, "")
			for i := 2; i <= 6; i++ {
				next := newPerson().signup()
				tt.reuse(first, next)
				status, code := http.StatusConflict, tt.code
				if i == 6 {
					status, code = http.StatusTooManyRequests, "too_many"
				}
				c.expect(c.post("/auth/signup", next), status, code)
			}
		})
	}
}

func TestPhoneCodeRules(t *testing.T) {
	ctx := context.Background()

	t.Run("five wrong tries kill the code", func(t *testing.T) {
		e := newEnv(t)
		p := newPerson()
		c := e.client()
		c.expect(c.post("/auth/signup", p.signup()), http.StatusCreated, "")
		right := e.lastCode(p.phone)
		for i := 0; i < 5; i++ {
			c.expect(c.post("/auth/confirm/phone", map[string]string{"code": "wrong!"}), 422, "code_wrong")
		}
		c.expect(c.post("/auth/confirm/phone", map[string]string{"code": right}), 429, "code_locked")
	})

	t.Run("an old code expires", func(t *testing.T) {
		e := newEnv(t)
		p := newPerson()
		c := e.client()
		c.expect(c.post("/auth/signup", p.signup()), http.StatusCreated, "")
		_, err := e.db.Exec(ctx, `UPDATE auth_codes SET expires_at = NOW() - INTERVAL '1 second'
			WHERE user_id = (SELECT id FROM users WHERE email = $1) AND purpose = 'phone_confirm'`, p.email)
		if err != nil {
			t.Fatal(err)
		}
		c.expect(c.post("/auth/confirm/phone", map[string]string{"code": e.lastCode(p.phone)}), 422, "code_expired")
	})

	t.Run("send again waits a minute, then replaces the code", func(t *testing.T) {
		e := newEnv(t)
		p := newPerson()
		c := e.client()
		c.expect(c.post("/auth/signup", p.signup()), http.StatusCreated, "")
		first := e.lastCode(p.phone)
		r := c.post("/auth/resend", map[string]string{"channel": "whatsapp"})
		c.expect(r, 429, "send_too_soon")
		if r.Header.Get("Retry-After") == "" {
			t.Fatal("no Retry-After header")
		}
		// Pretend the minute has passed.
		_, err := e.db.Exec(ctx, `UPDATE auth_codes SET created_at = created_at - INTERVAL '2 minutes'
			WHERE user_id = (SELECT id FROM users WHERE email = $1)`, p.email)
		if err != nil {
			t.Fatal(err)
		}
		c.expect(c.post("/auth/resend", map[string]string{"channel": "whatsapp"}), http.StatusNoContent, "")
		m, _ := e.sent.LastText(p.phone)
		if m.Channel != notify.WhatsApp {
			t.Fatalf("channel = %q, want whatsapp", m.Channel)
		}
		second := e.lastCode(p.phone)
		if first != second {
			c.expect(c.post("/auth/confirm/phone", map[string]string{"code": first}), 422, "code_wrong")
		}
		c.expect(c.post("/auth/confirm/phone", map[string]string{"code": second}), http.StatusOK, "")
		c.expect(c.post("/auth/resend", map[string]string{"channel": "carrier-pigeon"}), 422, "invalid_channel")
	})

	t.Run("five sends an hour", func(t *testing.T) {
		e := newEnv(t)
		p := newPerson()
		c := e.client()
		c.expect(c.post("/auth/signup", p.signup()), http.StatusCreated, "")
		for i := 0; i < 5; i++ {
			_, _ = e.db.Exec(ctx, `UPDATE auth_codes SET created_at = created_at - INTERVAL '61 seconds'
				WHERE user_id = (SELECT id FROM users WHERE email = $1)`, p.email)
			want, code := http.StatusNoContent, ""
			if i == 4 {
				want, code = 429, "too_many"
			}
			c.expect(c.post("/auth/resend", map[string]string{"channel": "sms"}), want, code)
		}
	})
}

func TestSigninProtections(t *testing.T) {
	e := newEnv(t)
	p := newPerson()
	c := e.client()
	c.expect(c.post("/auth/signup", p.signup()), http.StatusCreated, "")

	t.Run("unknown account looks like a wrong password", func(t *testing.T) {
		c := e.client()
		c.expect(c.post("/auth/signin", map[string]string{"login": "nobody@example.test", "password": "whatever-123"}), 401, "bad_login")
		c.expect(c.post("/auth/signin", map[string]string{"login": "not a login", "password": "whatever-123"}), 401, "bad_login")
	})

	t.Run("forgot says nothing about unknown accounts", func(t *testing.T) {
		c := e.client()
		before := len(e.sent.Texts)
		c.expect(c.post("/auth/forgot", map[string]string{"login": "nobody@example.test"}), http.StatusNoContent, "")
		if len(e.sent.Texts) != before {
			t.Fatal("a code was sent for an account that doesn't exist")
		}
	})

	t.Run("ten tries per login, then a wait", func(t *testing.T) {
		c := e.client()
		for i := 0; i < 10; i++ {
			c.expect(c.post("/auth/signin", map[string]string{"login": p.email, "password": "wrong-password"}), 401, "bad_login")
		}
		c.expect(c.post("/auth/signin", map[string]string{"login": p.email, "password": p.password}), 429, "too_many")
	})

	t.Run("a paused account is signed out and can't sign in", func(t *testing.T) {
		q := newPerson()
		c := e.client()
		c.expect(c.post("/auth/signup", q.signup()), http.StatusCreated, "")
		if _, err := e.db.Exec(context.Background(), `UPDATE users SET status = 'suspended' WHERE email = $1`, q.email); err != nil {
			t.Fatal(err)
		}
		c.expect(c.do(http.MethodGet, "/me", nil), 401, "signed_out")
		c.expect(c.post("/auth/signin", map[string]string{"login": q.email, "password": q.password}), 403, "suspended")
	})

	t.Run("forms from other sites are refused", func(t *testing.T) {
		resp, err := http.Post(e.server.URL+"/auth/signin", "application/x-www-form-urlencoded", strings.NewReader("login=a&password=b"))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnsupportedMediaType {
			t.Fatalf("status = %d, want 415", resp.StatusCode)
		}
	})
}

func TestSendFailureDoesNotBlockSignup(t *testing.T) {
	e := newEnv(t)
	e.sent.Fail = notify.ErrProvider
	p := newPerson()
	c := e.client()
	c.expect(c.post("/auth/signup", p.signup()), http.StatusCreated, "")
	c.expect(c.do(http.MethodGet, "/me", nil), http.StatusOK, "")
}

func TestErrorsMatchBySentinel(t *testing.T) {
	err := fmt.Errorf("wrapped: %w", &accounts.Error{Code: "send_too_soon", RetryAfter: 30})
	if !errors.Is(err, accounts.ErrSendTooSoon) {
		t.Fatal("a send_too_soon with a wait should still match ErrSendTooSoon")
	}
	if errors.Is(err, accounts.ErrTooMany) {
		t.Fatal("different codes must not match")
	}
}
