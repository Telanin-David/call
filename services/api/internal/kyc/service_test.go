package kyc

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/notify"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

var jpeg = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3})

func newRep(t *testing.T, s *Service, name string) auth.User {
	t.Helper()
	id := testdb.NewUser(t, s.DB)
	u, err := auth.ScanUser(s.DB.QueryRow(context.Background(), `
		UPDATE users SET name = $2, email_confirmed = true, phone_confirmed = true, status = 'active' WHERE id = $1 RETURNING `+auth.UserCols, id, name))
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestIDCheck(t *testing.T) {
	ctx := context.Background()
	fake := NewFake()
	mail := &notify.Fake{}
	now := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	s := &Service{DB: testdb.Pool(t), Provider: fake, Mail: mail, Now: func() time.Time { return now }}
	good := Input{IDType: "national_id", Country: "NG", IDImage: jpeg, Selfie: jpeg, Liveness: []string{jpeg, jpeg}}

	t.Run("what is sent is checked first", func(t *testing.T) {
		u := newRep(t, s, "Ada Obi")
		tests := []struct {
			name string
			in   Input
			want error
		}{
			{"id type", Input{IDType: "library_card", Country: "NG", IDImage: jpeg, Selfie: jpeg}, ErrBadIDType},
			{"country", Input{IDType: "passport", Country: "Nigeria", IDImage: jpeg, Selfie: jpeg}, ErrBadCountry},
			{"not an image", Input{IDType: "passport", Country: "NG", IDImage: base64.StdEncoding.EncodeToString([]byte("hello")), Selfie: jpeg}, ErrBadImage},
			{"no selfie", Input{IDType: "passport", Country: "NG", IDImage: jpeg}, ErrNoSelfie},
		}
		for _, tt := range tests {
			if _, err := s.Start(ctx, u, tt.in); !errors.Is(err, tt.want) {
				t.Errorf("%s: %v, want %v", tt.name, err, tt.want)
			}
		}
		if c, _ := s.Latest(ctx, u.ID); c.Status != None {
			t.Errorf("nothing recorded, got %+v", c)
		}
	})

	t.Run("approved", func(t *testing.T) {
		u := newRep(t, s, "Ada Obi")
		c, err := s.Start(ctx, u, good)
		if err != nil || c.Status != Pending || c.IDType != "national_id" || c.Country != "NG" {
			t.Fatalf("start = %+v, %v", c, err)
		}
		job := fake.Jobs[len(fake.Jobs)-1]
		if job.ID != c.ID || job.UserID != u.ID || len(job.Liveness) != 2 || job.IDImage[0] != 0xFF {
			t.Errorf("sent %+v", job)
		}
		if _, err := s.Start(ctx, u, good); !errors.Is(err, ErrPending) {
			t.Errorf("second while pending: %v", err)
		}
		// Still checking: nothing changes.
		if err := s.Refresh(ctx, c.ID); err != nil {
			t.Fatal(err)
		}
		fake.SetResult(c.ID, Result{Outcome: Approved, NameOnID: "OBI ADA"})
		body, _ := json.Marshal(map[string]string{"user_id": u.ID, "job_id": c.ID})
		if err := s.HandleCallback(ctx, body); err != nil {
			t.Fatal(err)
		}
		c, _ = s.Latest(ctx, u.ID)
		if c.Status != Verified || c.DecidedAt == nil {
			t.Fatalf("after result: %+v", c)
		}
		if m, ok := mail.LastEmail(u.Email); !ok || m.Subject != "Your ID is verified" {
			t.Errorf("email = %+v", m)
		}
		if _, err := s.Start(ctx, u, good); !errors.Is(err, ErrAlreadyVerified) {
			t.Errorf("after approval: %v", err)
		}
		// A repeated callback changes nothing and sends no second email.
		mail.Emails = nil
		_ = s.HandleCallback(ctx, body)
		if len(mail.Emails) != 0 {
			t.Errorf("second callback emailed again")
		}
	})

	t.Run("name doesn't match: waits for a person", func(t *testing.T) {
		u := newRep(t, s, "Ada Obi")
		c, _ := s.Start(ctx, u, good)
		fake.SetResult(c.ID, Result{Outcome: Approved, NameOnID: "BEN NWOSU"})
		if err := s.Refresh(ctx, c.ID); err != nil {
			t.Fatal(err)
		}
		c, _ = s.Latest(ctx, u.ID)
		if c.Status != Review {
			t.Fatalf("status %s, want review", c.Status)
		}
		var approved bool
		_ = s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM verifications WHERE user_id = $1 AND status = 'approved')`, u.ID).Scan(&approved)
		if approved {
			t.Error("a name mismatch must not lift the limits")
		}
	})

	t.Run("rejected, then tries run out", func(t *testing.T) {
		u := newRep(t, s, "Ada Obi")
		for i := range TriesPerDay {
			c, err := s.Start(ctx, u, good)
			if err != nil {
				t.Fatalf("try %d: %v", i+1, err)
			}
			fake.SetResult(c.ID, Result{Outcome: Rejected, Reason: "Document not verified"})
			if err := s.Refresh(ctx, c.ID); err != nil {
				t.Fatal(err)
			}
			if c, _ := s.Latest(ctx, u.ID); c.Status != Failed || c.Reason != "Document not verified" {
				t.Fatalf("try %d: %+v", i+1, c)
			}
		}
		if _, err := s.Start(ctx, u, good); !errors.Is(err, ErrTooManyTries) {
			t.Errorf("fourth try today: %v", err)
		}
		if m, _ := mail.LastEmail(u.Email); m.Subject != "We couldn't verify your ID" {
			t.Errorf("email = %+v", m)
		}
	})

	t.Run("provider down: nothing recorded, no try used", func(t *testing.T) {
		u := newRep(t, s, "Ada Obi")
		fake.Fail = true
		_, err := s.Start(ctx, u, good)
		fake.Fail = false
		if !errors.Is(err, ErrUnavailable) {
			t.Fatalf("start = %v", err)
		}
		if c, _ := s.Latest(ctx, u.ID); c.Status != None {
			t.Errorf("left %+v", c)
		}
	})

	t.Run("worker looks up checks whose callback never came", func(t *testing.T) {
		u := newRep(t, s, "Ada Obi")
		c, _ := s.Start(ctx, u, good)
		fake.SetResult(c.ID, Result{Outcome: Approved})
		if n, _ := s.CheckPending(ctx); n != 0 {
			t.Errorf("too soon: looked up %d", n)
		}
		now = now.Add(3 * time.Minute)
		defer func() { now = now.Add(-3 * time.Minute) }()
		if _, err := s.CheckPending(ctx); err != nil {
			t.Fatal(err)
		}
		if c, _ := s.Latest(ctx, u.ID); c.Status != Verified {
			t.Errorf("after worker: %+v", c)
		}
	})

	t.Run("callbacks for unknown jobs or another rep are ignored", func(t *testing.T) {
		u := newRep(t, s, "Ada Obi")
		other := newRep(t, s, "Ben Nwosu")
		c, _ := s.Start(ctx, u, good)
		fake.SetResult(c.ID, Result{Outcome: Approved})
		body, _ := json.Marshal(map[string]string{"user_id": other.ID, "job_id": c.ID})
		if err := s.HandleCallback(ctx, body); err != nil {
			t.Fatal(err)
		}
		if c, _ := s.Latest(ctx, u.ID); c.Status != Pending {
			t.Errorf("a callback naming another rep moved it: %+v", c)
		}
		if err := s.HandleCallback(ctx, []byte(`nope`)); !errors.Is(err, ErrBadSignature) {
			t.Errorf("garbage: %v", err)
		}
	})
}

func TestIDCheckHTTP(t *testing.T) {
	fake := NewFake()
	s := &Service{DB: testdb.Pool(t), Provider: fake}
	u := newRep(t, s, "Ada Obi")
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(auth.WithUser(req.Context(), u)))
		})
	})
	s.Routes(r)
	s.DevRoutes(r)
	s.WebhookRoutes(r)
	srv := httptest.NewServer(r)
	defer srv.Close()
	call := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req, _ := http.NewRequest(method, srv.URL+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		out := map[string]any{}
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}

	if st, b := call(http.MethodGet, "/verification", nil); st != 200 || b["status"] != "none" || b["submitted_at"] != nil {
		t.Fatalf("GET before = %d %v", st, b)
	}
	if st, b := call(http.MethodPost, "/verification", map[string]any{"id_type": "passport", "country": "NG", "id_image": jpeg}); st != 422 || b["code"] != "no_selfie" {
		t.Errorf("no selfie = %d %v", st, b)
	}
	st, b := call(http.MethodPost, "/verification", map[string]any{"id_type": "passport", "country": "NG", "id_image": jpeg, "selfie": jpeg})
	if st != 202 || b["status"] != "pending" || b["id_type"] != "passport" {
		t.Fatalf("POST = %d %v", st, b)
	}
	if st, b := call(http.MethodPost, "/dev/verification/approve", nil); st != 200 || b["status"] != "approved" || b["decided_at"] == nil {
		t.Errorf("dev approve = %d %v", st, b)
	}
	if st, _ := call(http.MethodPost, "/webhooks/smileid", map[string]any{"nothing": true}); st != 401 {
		t.Errorf("unsigned callback = %d", st)
	}
}
