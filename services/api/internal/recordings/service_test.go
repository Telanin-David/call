package recordings

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/calls"
	"github.com/telanin-david/call/services/api/internal/ledger"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/storage"
	"github.com/telanin-david/call/services/api/internal/telephony"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

// 5 Oct 2026, 15:00 UTC: 11 am in New York.
var morning = time.Date(2026, 10, 5, 15, 0, 0, 0, time.UTC)

type env struct {
	t     *testing.T
	clock time.Time
	fake  *telephony.FakeCalls
	dir   *storage.Dir
	calls *calls.Service
	svc   *Service
}

func newEnv(t *testing.T) *env {
	e := &env{t: t, clock: morning, fake: telephony.NewFakeCalls(), dir: &storage.Dir{Root: t.TempDir(), Secret: []byte("test")}}
	now := func() time.Time { return e.clock }
	e.fake.Now = now
	db := testdb.Pool(t)
	e.calls = &calls.Service{DB: db, Provider: e.fake, Recording: true, Now: now}
	e.svc = &Service{DB: db, Provider: e.fake, Store: e.dir, Now: now}
	return e
}

var seq int

// rep makes an active rep on plan with $10, a New York number and a lead.
func (e *env) rep(plan string) (auth.User, string) {
	e.t.Helper()
	ctx := context.Background()
	db := e.svc.DB
	id := testdb.NewUser(e.t, db)
	u, err := auth.ScanUser(db.QueryRow(ctx, `
		UPDATE users SET email_confirmed = true, phone_confirmed = true, status = 'active', timezone = 'Africa/Lagos', created_at = $2
		WHERE id = $1 RETURNING `+auth.UserCols, id, morning.AddDate(0, -2, 0)))
	if err != nil {
		e.t.Fatal(err)
	}
	seq++
	if err := platform.InTx(ctx, db, func(tx pgx.Tx) error {
		_, err := ledger.Credit(ctx, tx, ledger.Posting{UserID: u.ID, Type: ledger.TypeTopUp, Amount: 10_000_000, Key: fmt.Sprintf("test:rec:%s:%d", u.ID, seq)})
		return err
	}); err != nil {
		e.t.Fatal(err)
	}
	if plan != "free" {
		if _, err := db.Exec(ctx, `INSERT INTO subscriptions (user_id, plan_id, next_renewal) VALUES ($1, $2, '2026-11-05')`, u.ID, plan); err != nil {
			e.t.Fatal(err)
		}
	}
	n := 5000000 + (time.Now().Nanosecond()/1000+seq*7919)%4000000
	if _, err := db.Exec(ctx, `INSERT INTO numbers (user_id, number, provider_id, monthly_cost, monthly_price, is_default, renews_at)
		VALUES ($1, $2, 'x', 1, 2, true, now() + interval '1 month')`, u.ID, fmt.Sprintf("+1646%07d", n)); err != nil {
		e.t.Fatal(err)
	}
	var list, lead string
	if err := db.QueryRow(ctx, `INSERT INTO lead_lists (user_id, name) VALUES ($1, 'October') RETURNING id`, u.ID).Scan(&list); err != nil {
		e.t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `INSERT INTO leads (list_id, user_id, first_name, last_name, company, phone) VALUES ($1, $2, 'Ada', 'Obi', 'Obi Cleaning', $3) RETURNING id`,
		list, u.ID, fmt.Sprintf("+1212%07d", n)).Scan(&lead); err != nil {
		e.t.Fatal(err)
	}
	return u, lead
}

// call makes a call that is answered, lasts talk, and is hung up by the rep.
func (e *env) call(u auth.User, lead string, talk time.Duration) string {
	e.t.Helper()
	ctx := context.Background()
	st, err := e.calls.Start(ctx, u, lead)
	if err != nil {
		e.t.Fatal(err)
	}
	for _, typ := range []telephony.EventType{telephony.EventInitiated, telephony.EventAnswered} {
		body, h := e.fake.Event(telephony.CallEvent{Type: typ, CallControlID: "cc-" + st.CallID, ClientState: st.ClientState, From: st.From, To: st.To, At: e.clock})
		ev, err := e.fake.ParseEvent(h, body, e.clock)
		if err == nil {
			err = e.calls.HandleEvent(ctx, ev)
		}
		if err != nil {
			e.t.Fatal(err)
		}
	}
	e.clock = e.clock.Add(talk)
	if _, err := e.calls.Hangup(ctx, u.ID, st.CallID); err != nil {
		e.t.Fatal(err)
	}
	e.clock = e.clock.Add(time.Second)
	if err := e.calls.DeliverFake(ctx); err != nil {
		e.t.Fatal(err)
	}
	return st.CallID
}

func (e *env) status(callID string) string {
	var s string
	_ = e.svc.DB.QueryRow(context.Background(), `SELECT status FROM recordings WHERE call_id = $1`, callID).Scan(&s)
	return s
}

func TestSetting(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	starter, _ := e.rep("starter")
	if _, err := e.svc.SetRecording(ctx, starter.ID, true, true); !errors.Is(err, ErrNotPro) {
		t.Errorf("Starter: %v", err)
	}
	pro, _ := e.rep("pro")
	if st, _ := e.svc.Setting(ctx, pro.ID); st.On || !st.Pro || !st.Available {
		t.Errorf("off until agreed: %+v", st)
	}
	if _, err := e.svc.SetRecording(ctx, pro.ID, true, false); !errors.Is(err, ErrMustAgree) {
		t.Errorf("without agreeing: %v", err)
	}
	st, err := e.svc.SetRecording(ctx, pro.ID, true, true)
	if err != nil || !st.On || st.AgreedAt == nil || !st.AgreedAt.Equal(morning) {
		t.Fatalf("on: %+v, %v", st, err)
	}
	if on, _ := calls.RecordsCalls(ctx, e.svc.DB, pro.ID); !on {
		t.Error("calls don't see it on")
	}
	if st, err := e.svc.SetRecording(ctx, pro.ID, false, false); err != nil || st.On || st.AgreedAt != nil {
		t.Errorf("off: %+v, %v", st, err)
	}
	off := &Service{DB: e.svc.DB}
	if _, err := off.SetRecording(ctx, pro.ID, true, true); !errors.Is(err, ErrUnavailable) {
		t.Errorf("no storage: %v", err)
	}
}

func TestRecordedCall(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	u, lead := e.rep("pro")

	t.Run("not recorded until the rep agrees", func(t *testing.T) {
		id := e.call(u, lead, 20*time.Second)
		if s := e.status(id); s != "" {
			t.Errorf("recording %q without agreeing", s)
		}
		if _, err := e.svc.Get(ctx, u.ID, id); !errors.Is(err, ErrNotFound) {
			t.Errorf("get: %v", err)
		}
	})
	if _, err := e.svc.SetRecording(ctx, u.ID, true, true); err != nil {
		t.Fatal(err)
	}

	var id string
	t.Run("recorded, copied to storage, played through a short link", func(t *testing.T) {
		id = e.call(u, lead, 42*time.Second)
		if s := e.status(id); s != "saved" {
			t.Fatalf("after the call: %q", s)
		}
		if r, err := e.svc.Get(ctx, u.ID, id); err != nil || r.Status != "processing" || r.URL != "" {
			t.Errorf("before the copy: %+v, %v", r, err)
		}
		if n, err := e.svc.CopyPending(ctx); err != nil || n != 1 {
			t.Fatalf("copy = %d, %v", n, err)
		}
		r, err := e.svc.Get(ctx, u.ID, id)
		if err != nil || r.Status != "ready" || r.Seconds != 42 || r.Call.LeadName != "Ada Obi" || r.Call.Seconds != 42 || r.KeepUntil == nil {
			t.Fatalf("ready: %+v, %v", r, err)
		}
		if !r.KeepUntil.Equal(e.clock.Add(Keep)) {
			t.Errorf("kept until %v", r.KeepUntil)
		}
		w := e.fetch(r.URL)
		if w.Code != 200 || w.Body.Len() != 44+42*8000*2 || w.Header().Get("Content-Type") != "audio/wav" {
			t.Errorf("play: %d, %d bytes, %v", w.Code, w.Body.Len(), w.Header())
		}
		if w := e.fetch(r.DownloadURL); !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment; filename=call-2026-10-05-1500.wav") {
			t.Errorf("download: %v", w.Header())
		}
		e.clock = e.clock.Add(LinkLife + time.Second)
		if w := e.fetch(r.URL); w.Code != http.StatusForbidden {
			t.Errorf("an old link still plays: %d", w.Code)
		}
		items, _, err := e.calls.History(ctx, u.ID, "", "", nil, 5)
		if err != nil || items[0].ID != id || items[0].Recording != "ready" || items[1].Recording != "none" {
			t.Errorf("history: %+v, %v", items, err)
		}
	})

	t.Run("only the rep's own", func(t *testing.T) {
		other, _ := e.rep("pro")
		if _, err := e.svc.Get(ctx, other.ID, id); !errors.Is(err, ErrNotFound) {
			t.Errorf("another rep reads it: %v", err)
		}
		if err := e.svc.Delete(ctx, other.ID, id); !errors.Is(err, ErrNotFound) {
			t.Errorf("another rep deletes it: %v", err)
		}
	})

	t.Run("delete removes the file", func(t *testing.T) {
		var key string
		_ = e.svc.DB.QueryRow(ctx, `SELECT storage_key FROM recordings WHERE call_id = $1`, id).Scan(&key)
		if err := e.svc.Delete(ctx, u.ID, id); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(e.dir.Root, key)); !os.IsNotExist(err) {
			t.Errorf("file still there: %v", err)
		}
		if r, err := e.svc.Get(ctx, u.ID, id); err != nil || r.Status != "deleted" || r.URL != "" {
			t.Errorf("after delete: %+v, %v", r, err)
		}
		if err := e.svc.Delete(ctx, u.ID, id); err != nil {
			t.Errorf("twice: %v", err)
		}
	})

	t.Run("deleted after 90 days", func(t *testing.T) {
		old := e.call(u, lead, 10*time.Second)
		if _, err := e.svc.CopyPending(ctx); err != nil {
			t.Fatal(err)
		}
		e.clock = e.clock.Add(Keep - time.Hour)
		if n, err := e.svc.Expire(ctx); err != nil || e.status(old) != "stored" {
			t.Errorf("before 90 days: %d %v %s", n, err, e.status(old))
		}
		e.clock = e.clock.Add(2 * time.Hour)
		if n, err := e.svc.Expire(ctx); err != nil || n < 1 || e.status(old) != "deleted" {
			t.Errorf("after 90 days: %d %v %s", n, err, e.status(old))
		}
		e.clock = morning
	})

	t.Run("a copy that keeps failing is given up", func(t *testing.T) {
		var list, fresh string
		_ = e.svc.DB.QueryRow(ctx, `SELECT list_id FROM leads WHERE id = $1`, lead).Scan(&list)
		if err := e.svc.DB.QueryRow(ctx, `INSERT INTO leads (list_id, user_id, first_name, phone) VALUES ($1, $2, 'Bo', '+12125550142') RETURNING id`,
			list, u.ID).Scan(&fresh); err != nil {
			t.Fatal(err)
		}
		failing := e.call(u, fresh, 5*time.Second)
		e.fake.Fail = true
		for range copyTries {
			if _, err := e.svc.CopyPending(ctx); err != nil {
				t.Fatal(err)
			}
		}
		e.fake.Fail = false
		if s := e.status(failing); s != "failed" {
			t.Errorf("after %d failed copies: %q", copyTries, s)
		}
		if r, err := e.svc.Get(ctx, u.ID, failing); err != nil || r.Status != "failed" {
			t.Errorf("get: %+v, %v", r, err)
		}
	})
}

// fetch follows a play or download link through the dev file route.
func (e *env) fetch(link string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	e.svc.DevRoutes(r)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, link, nil))
	return w
}

func TestHTTP(t *testing.T) {
	e := newEnv(t)
	u, lead := e.rep("pro")
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(auth.WithUser(req.Context(), u)))
		})
	})
	e.svc.Routes(r)
	do := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, path, &buf))
		out := map[string]any{}
		_ = json.NewDecoder(w.Body).Decode(&out)
		return w.Code, out
	}
	if code, body := do(http.MethodPut, "/recordings/settings", map[string]bool{"on": true}); code != 422 || body["code"] != "recording_agree" {
		t.Errorf("on without agreeing: %d %v", code, body)
	}
	if code, body := do(http.MethodPut, "/recordings/settings", map[string]bool{"on": true, "agree": true}); code != 200 || body["on"] != true {
		t.Fatalf("on: %d %v", code, body)
	}
	id := e.call(u, lead, 30*time.Second)
	if code, body := do(http.MethodGet, "/recordings/"+id, nil); code != 200 || body["status"] != "processing" || body["url"] != nil {
		t.Errorf("processing: %d %v", code, body)
	}
	_, _ = e.svc.CopyPending(context.Background())
	code, body := do(http.MethodGet, "/recordings/"+id, nil)
	call, _ := body["call"].(map[string]any)
	if code != 200 || body["status"] != "ready" || !strings.HasPrefix(fmt.Sprint(body["url"]), storage.DevFilesPath) || call["lead_name"] != "Ada Obi" {
		t.Fatalf("ready: %d %v", code, body)
	}
	if code, _ := do(http.MethodGet, "/recordings/not-a-call", nil); code != 404 {
		t.Errorf("bad id: %d", code)
	}
	if code, _ := do(http.MethodDelete, "/recordings/"+id, nil); code != 204 {
		t.Errorf("delete: %d", code)
	}
	if _, body := do(http.MethodGet, "/recordings/"+id, nil); body["status"] != "deleted" {
		t.Errorf("after delete: %v", body)
	}
}
