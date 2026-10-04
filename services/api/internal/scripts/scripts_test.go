package scripts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

func TestClean(t *testing.T) {
	ok := []Part{{Title: "Opening", Body: "Hi {first_name}, this is Tunde."}}
	tests := []struct {
		name string
		in   Input
		err  error
	}{
		{"fine", Input{Name: "Office cleaning", Parts: ok}, nil},
		{"every fill-in word", Input{Name: "x", Parts: []Part{{Title: "a", Body: "{first_name} {company} {city} {her_time}"}}}, nil},
		{"an empty part beside a written one", Input{Name: "x", Parts: append([]Part{{Title: "Close", Body: "  "}}, ok...)}, nil},
		{"no name", Input{Name: "   ", Parts: ok}, ErrBadName},
		{"long name", Input{Name: strings.Repeat("a", 81), Parts: ok}, ErrBadName},
		{"no parts", Input{Name: "x"}, ErrNoParts},
		{"only empty parts", Input{Name: "x", Parts: []Part{{Title: "Opening", Body: " \n "}}}, ErrNoParts},
		{"too many parts", Input{Name: "x", Parts: make([]Part, maxParts+1)}, ErrTooManyParts},
		{"untitled part", Input{Name: "x", Parts: []Part{{Title: " ", Body: "Hi"}}}, ErrBadTitle},
		{"long part", Input{Name: "x", Parts: []Part{{Title: "a", Body: strings.Repeat("a", maxBodyLen+1)}}}, ErrTooLong},
		{"unknown word", Input{Name: "x", Parts: []Part{{Title: "a", Body: "Hi {firstname}"}}}, ErrUnknownField},
		{"empty brackets", Input{Name: "x", Parts: []Part{{Title: "a", Body: "Hi {}"}}}, ErrUnknownField},
		{"bad list id", Input{Name: "x", Parts: ok, ListIDs: &[]string{"nope"}}, ErrListNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := clean(tt.in); !errors.Is(err, tt.err) {
				t.Fatalf("clean = %v, want %v", err, tt.err)
			}
		})
	}

	got, _ := clean(Input{Name: "  Office   cleaning ", Parts: []Part{{Title: " Why  I'm calling ", Body: "  We clean.\r\nAll week. "}}})
	if got.Name != "Office cleaning" || got.Parts[0].Title != "Why I'm calling" || got.Parts[0].Body != "We clean.\nAll week." {
		t.Errorf("clean tidied to %+v", got)
	}
	_, err := clean(Input{Name: "x", Parts: []Part{{Title: "a", Body: "Hi {firstname}"}}})
	if !strings.Contains(err.Error(), "unknown_field") || !strings.HasPrefix(err.(*Error).Message, "{firstname} isn't") {
		t.Errorf("unknown word message = %q", err.(*Error).Message)
	}
}

func newList(t *testing.T, s *Service, user, name string) string {
	t.Helper()
	var id string
	if err := s.DB.QueryRow(context.Background(), `INSERT INTO lead_lists (user_id, name) VALUES ($1, $2) RETURNING id`, user, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func listScript(t *testing.T, s *Service, listID string) *string {
	t.Helper()
	var id *string
	if err := s.DB.QueryRow(context.Background(), `SELECT script_id::text FROM lead_lists WHERE id = $1`, listID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestScripts(t *testing.T) {
	ctx := context.Background()
	s := &Service{DB: testdb.Pool(t)}
	user := testdb.NewUser(t, s.DB)
	october, dental := newList(t, s, user, "October leads"), newList(t, s, user, "Dental offices")
	parts := []Part{{Title: "Opening", Body: "Hi {first_name}."}, {Title: "Close", Body: "Thursday at 10?"}}

	v2, err := s.Create(ctx, user, Input{Name: "Office cleaning v2", Parts: parts, ListIDs: &[]string{october}})
	if err != nil {
		t.Fatal(err)
	}
	if len(v2.Parts) != 2 || v2.Parts[0].Body != "Hi {first_name}." || len(v2.Lists) != 1 || v2.Lists[0].Name != "October leads" {
		t.Fatalf("created = %+v", v2)
	}
	if _, err := s.Create(ctx, user, Input{Name: "office CLEANING v2", Parts: parts}); !errors.Is(err, ErrNameTaken) {
		t.Fatalf("same name, other case: %v", err)
	}

	time.Sleep(5 * time.Millisecond)
	v1, err := s.Create(ctx, user, Input{Name: "Office cleaning v1", Parts: parts})
	if err != nil || len(v1.Lists) != 0 {
		t.Fatalf("v1 = %+v, %v", v1, err)
	}

	t.Run("moving a list to another script", func(t *testing.T) {
		v1, err := s.Update(ctx, user, v1.ID, Input{Name: "Office cleaning v1", Parts: parts, ListIDs: &[]string{october, dental, october}})
		if err != nil || len(v1.Lists) != 2 {
			t.Fatalf("update = %+v, %v", v1, err)
		}
		if got := listScript(t, s, october); got == nil || *got != v1.ID {
			t.Fatalf("October uses %v, want v1", got)
		}
		all, err := s.List(ctx, user)
		if err != nil || len(all) != 2 || all[0].ID != v1.ID || len(all[1].Lists) != 0 {
			t.Fatalf("list = %+v, %v (newest change first; v2 lost October)", all, err)
		}
	})

	t.Run("list_ids left out keeps the lists; empty clears them", func(t *testing.T) {
		v1, err := s.Update(ctx, user, v1.ID, Input{Name: "Office cleaning v1 (old)", Parts: parts})
		if err != nil || len(v1.Lists) != 2 || v1.Name != "Office cleaning v1 (old)" {
			t.Fatalf("update without list_ids = %+v, %v", v1, err)
		}
		v1, err = s.Update(ctx, user, v1.ID, Input{Name: v1.Name, Parts: parts, ListIDs: &[]string{dental}})
		if err != nil || len(v1.Lists) != 1 || listScript(t, s, october) != nil {
			t.Fatalf("narrowed = %+v, %v; October %v", v1, err, listScript(t, s, october))
		}
	})

	t.Run("another rep's script and lists are out of reach", func(t *testing.T) {
		other := testdb.NewUser(t, s.DB)
		theirs := newList(t, s, other, "Theirs")
		if _, err := s.Update(ctx, other, v2.ID, Input{Name: "Mine now", Parts: parts}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("update another rep's script: %v", err)
		}
		if _, err := s.Update(ctx, user, v2.ID, Input{Name: v2.Name, Parts: parts, ListIDs: &[]string{theirs}}); !errors.Is(err, ErrListNotFound) {
			t.Fatalf("use another rep's list: %v", err)
		}
		if listScript(t, s, theirs) != nil {
			t.Fatal("another rep's list was changed")
		}
		if err := s.Delete(ctx, other, v2.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("delete another rep's script: %v", err)
		}
		mine, _ := s.List(ctx, other)
		if len(mine) != 0 {
			t.Fatalf("other rep sees %+v", mine)
		}
	})

	t.Run("delete leaves the list without a script", func(t *testing.T) {
		if err := s.Delete(ctx, user, v1.ID); err != nil {
			t.Fatal(err)
		}
		if listScript(t, s, dental) != nil {
			t.Fatal("Dental still points at a deleted script")
		}
		if err := s.Delete(ctx, user, v1.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("delete twice: %v", err)
		}
		if _, err := s.Update(ctx, user, "nope", Input{Name: "x", Parts: parts}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("bad id: %v", err)
		}
	})
}

func TestScriptLimit(t *testing.T) {
	ctx := context.Background()
	s := &Service{DB: testdb.Pool(t)}
	user := testdb.NewUser(t, s.DB)
	if _, err := s.DB.Exec(ctx, `INSERT INTO scripts (user_id, name) SELECT $1, 'Script ' || n FROM generate_series(1, $2::int) n`, user, maxScripts); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, user, Input{Name: "One more", Parts: []Part{{Title: "a", Body: "b"}}}); !errors.Is(err, ErrTooMany) {
		t.Fatalf("over the limit: %v", err)
	}
}

func TestFreeUntil(t *testing.T) {
	ctx := context.Background()
	s := &Service{DB: testdb.Pool(t)}
	user := testdb.NewUser(t, s.DB)
	if _, err := s.DB.Exec(ctx, `UPDATE users SET created_at = '2026-10-04 23:30:00+00' WHERE id = $1`, user); err != nil {
		t.Fatal(err)
	}
	until, err := FreeUntil(ctx, s.DB, user)
	if err != nil || until == nil || until.Format("2006-01-02") != "2026-12-04" {
		t.Fatalf("Free: %v, %v; want 2026-12-04", until, err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO subscriptions (user_id, plan_id, next_renewal) VALUES ($1, 'starter', '2026-11-04')`, user); err != nil {
		t.Fatal(err)
	}
	if until, err := FreeUntil(ctx, s.DB, user); err != nil || until != nil {
		t.Fatalf("Starter: %v, %v; want always shown", until, err)
	}
}

func TestHTTP(t *testing.T) {
	s := &Service{DB: testdb.Pool(t)}
	confirmed := auth.User{ID: testdb.NewUser(t, s.DB), EmailConfirmed: true, PhoneConfirmed: true}
	unconfirmed := auth.User{ID: testdb.NewUser(t, s.DB)}
	users := map[string]auth.User{confirmed.ID: confirmed, unconfirmed.ID: unconfirmed}
	list := newList(t, s, confirmed.ID, "October leads")
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if v, ok := users[req.Header.Get("X-Test-User")]; ok {
				req = req.WithContext(auth.WithUser(req.Context(), v))
			}
			next.ServeHTTP(w, req)
		})
	})
	s.Routes(r)
	srv := httptest.NewServer(r)
	defer srv.Close()

	call := func(user, method, path string, body any) (int, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req, _ := http.NewRequest(method, srv.URL+path, &buf)
		req.Header.Set("X-Test-User", user)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		out := map[string]any{}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}

	if status, _ := call("", http.MethodGet, "/scripts", nil); status != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", status)
	}
	status, body := call(confirmed.ID, http.MethodGet, "/scripts", nil)
	if status != 200 || len(body["scripts"].([]any)) != 0 || body["on_screen_free_until"] == nil || len(body["fields"].([]any)) != 4 {
		t.Fatalf("empty list: %d %v", status, body)
	}

	script := map[string]any{"name": "Office cleaning v2", "parts": []Part{{Title: "Opening", Body: "Hi {first_name}."}}, "list_ids": []string{list}}
	if status, _ := call(unconfirmed.ID, http.MethodPost, "/scripts", script); status != http.StatusForbidden {
		t.Fatalf("unconfirmed save: %d", status)
	}
	status, body = call(confirmed.ID, http.MethodPost, "/scripts", script)
	if status != http.StatusCreated || body["name"] != "Office cleaning v2" || len(body["lists"].([]any)) != 1 {
		t.Fatalf("create: %d %v", status, body)
	}
	id := body["id"].(string)

	status, body = call(confirmed.ID, http.MethodPut, "/scripts/"+id, map[string]any{"name": "v3", "parts": []Part{{Title: "Opening", Body: "Hi {firstname}"}}})
	if status != 422 || body["code"] != "unknown_field" {
		t.Fatalf("unknown word: %d %v", status, body)
	}
	status, body = call(confirmed.ID, http.MethodPut, "/scripts/"+id, map[string]any{"name": "v3", "parts": []Part{{Title: "Opening", Body: "Hello"}}, "list_ids": []string{}})
	if status != 200 || body["name"] != "v3" || len(body["lists"].([]any)) != 0 {
		t.Fatalf("update: %d %v", status, body)
	}
	if status, body := call(confirmed.ID, http.MethodPost, "/scripts", map[string]any{"name": "V3", "parts": []Part{{Title: "a", Body: "b"}}}); status != 409 || body["code"] != "name_taken" {
		t.Fatalf("name taken: %d %v", status, body)
	}
	if status, _ := call(confirmed.ID, http.MethodDelete, "/scripts/"+id, nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if status, body := call(confirmed.ID, http.MethodDelete, "/scripts/"+id, nil); status != 404 || body["code"] != "script_not_found" {
		t.Fatalf("delete again: %d %v", status, body)
	}
}
