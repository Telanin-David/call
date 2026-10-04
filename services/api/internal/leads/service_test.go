package leads

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/phone"
	"github.com/telanin-david/call/services/api/internal/testdb"
)

// boardFile is the upload on the board: 8 rows, of which 3 are added, 2 are
// abroad, 2 are duplicates, 1 is on the do-not-call list.
const boardFile = `First Name,Last Name,Business,Phone,Email Address,City,Sites,Notes
Lena,Park,Sparkle Offices,(646) 555-0110,lena@sparkleoffices.com,"Brooklyn, NY",3,Unhappy with Friday cleaner
Tom,Allen,Allen Dental,(917) 555-0142,,New York,1,
Kofi,Asante,,+233 24 555 0190,,Accra,1,
Amy,Clarke,,+44 20 7946 0958,,London,1,
Lena,Park,Sparkle Offices,646.555.0110,,,,
Tom,Allen,,1-917-555-0142,,,,
Maria,Gomez,Gomez Realty,(305) 555-0117,,Miami,2,
Raj,Patel,Patel Motors,(213) 555-0199,,Los Angeles,1,
`

var boardMapping = []Field{FirstName, LastName, Company, Phone, Email, City, Skip, Notes}

func TestCheck(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	s := &Service{DB: pool}
	user := testdb.NewUser(t, pool)
	if err := AddDNC(ctx, pool, user, "+13055550117", "manual"); err != nil {
		t.Fatal(err)
	}
	if err := AddDNC(ctx, pool, user, "+13055550117", "manual"); err != nil {
		t.Fatalf("adding a do-not-call number twice: %v", err)
	}

	c, err := s.Check(ctx, user, boardFile, nil)
	if err != nil {
		t.Fatal(err)
	}
	if c.Problem != nil {
		t.Fatalf("problem = %v", c.Problem)
	}
	if !equalFields(c.Mapping, boardMapping) {
		t.Fatalf("mapping = %v, want %v", c.Mapping, boardMapping)
	}
	if got := phones(c.Ready); got != "+16465550110 +19175550142 +12135550199" {
		t.Errorf("ready = %s", got)
	}
	if got := phones(c.Abroad); got != "+233245550190 +442079460958" {
		t.Errorf("abroad = %s", got)
	}
	want := []struct {
		line   int
		reason Reason
		same   int
	}{{4, Abroad, 0}, {5, Abroad, 0}, {6, Duplicate, 2}, {7, Duplicate, 3}, {8, DNC, 0}}
	if len(c.LeftOut) != len(want) {
		t.Fatalf("left out = %+v", c.LeftOut)
	}
	for i, w := range want {
		o := c.LeftOut[i]
		if o.Lead.Line != w.line || o.Reason != w.reason || o.SameAs != w.same {
			t.Errorf("left out %d = line %d %s same as %d; want %+v", i, o.Lead.Line, o.Reason, o.SameAs, w)
		}
	}
	if c.LeftOut[2].RawPhone != "646.555.0110" {
		t.Errorf("raw phone = %q, want it as written", c.LeftOut[2].RawPhone)
	}

	t.Run("bad numbers and premium lines", func(t *testing.T) {
		c, err := s.Check(ctx, user, "Name,Phone\nA,n/a\nB,\nC,1-900-555-0123\nD,(212) 976-5555\nE,+881 6 1234 5678\n", nil)
		if err != nil {
			t.Fatal(err)
		}
		var reasons []Reason
		for _, o := range c.LeftOut {
			reasons = append(reasons, o.Reason)
		}
		if got := stringsOf(reasons); got != "invalid invalid premium premium premium" {
			t.Errorf("reasons = %v", reasons)
		}
		if len(c.Ready) != 0 {
			t.Errorf("ready = %v", c.Ready)
		}
	})

	t.Run("no phone column is a problem to fix, not a failure", func(t *testing.T) {
		c, err := s.Check(ctx, user, "Name,Sites\nLena,3\n", nil)
		if err != nil || c.Problem == nil || c.Problem.Code != "no_phone_column" || len(c.File.Headers) != 2 {
			t.Fatalf("check = %+v, %v", c, err)
		}
	})

	t.Run("a broken mapping from the client is refused", func(t *testing.T) {
		if _, err := s.Check(ctx, user, "Name,Phone\nLena,6465550110\n", []Field{Phone}); !errors.Is(err, ErrBadMapping) {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestAddAndLists(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	s := &Service{DB: pool}
	user := testdb.NewUser(t, pool)
	if err := AddDNC(ctx, pool, user, "+13055550117", "manual"); err != nil {
		t.Fatal(err)
	}

	if _, err := s.Add(ctx, user, boardFile, boardMapping, "  "); !errors.Is(err, ErrBadListName) {
		t.Fatalf("blank name: %v", err)
	}
	if _, err := s.Add(ctx, user, boardFile, []Field{Skip, Skip, Skip, Skip, Skip, Skip, Skip, Skip}, "October"); !errors.Is(err, ErrNoPhoneColumn) {
		t.Fatalf("no phone column: %v", err)
	}

	lists, err := s.Add(ctx, user, boardFile, boardMapping, " October   leads ")
	if err != nil {
		t.Fatal(err)
	}
	if len(lists) != 2 {
		t.Fatalf("lists = %+v, want the list and the abroad list", lists)
	}
	main, abroad := lists[0], lists[1]
	if main.Name != "October leads" || main.Region != phone.USCA || main.Total != 3 || main.Status() != "new" {
		t.Errorf("main list = %+v", main)
	}
	if abroad.Name != "October leads"+AbroadSuffix || abroad.Region != phone.Abroad || abroad.Total != 2 || abroad.Status() != "abroad" {
		t.Errorf("abroad list = %+v", abroad)
	}

	var first, last, company, email, city, notes string
	if err := pool.QueryRow(ctx, `SELECT first_name, last_name, company, email, city, notes FROM leads WHERE list_id = $1 AND phone = '+16465550110'`,
		main.ID).Scan(&first, &last, &company, &email, &city, &notes); err != nil {
		t.Fatal(err)
	}
	if first != "Lena" || last != "Park" || company != "Sparkle Offices" || email != "lena@sparkleoffices.com" || city != "Brooklyn, NY" || notes != "Unhappy with Friday cleaner" {
		t.Errorf("lead = %q %q %q %q %q %q", first, last, company, email, city, notes)
	}

	t.Run("uploading again leaves out what's already listed", func(t *testing.T) {
		c, err := s.Check(ctx, user, boardFile, boardMapping)
		if err != nil {
			t.Fatal(err)
		}
		if len(c.Ready) != 0 || len(c.Abroad) != 0 || c.LeftOut[0].Reason != Listed || c.LeftOut[0].ListName != main.Name || c.LeftOut[2].ListName != abroad.Name {
			t.Fatalf("check = ready %d abroad %d left out %+v", len(c.Ready), len(c.Abroad), c.LeftOut)
		}
		if _, err := s.Add(ctx, user, boardFile, boardMapping, "Again"); !errors.Is(err, ErrNothingToAdd) {
			t.Fatalf("add again: %v", err)
		}
	})

	t.Run("another rep's lists don't count", func(t *testing.T) {
		other := testdb.NewUser(t, pool)
		c, err := s.Check(ctx, other, boardFile, boardMapping)
		if err != nil || len(c.Ready) != 4 {
			t.Fatalf("other rep: ready %d, %v (their do-not-call list is empty, so Maria is ready too)", len(c.Ready), err)
		}
	})

	t.Run("progress and status", func(t *testing.T) {
		if _, err := pool.Exec(ctx, `UPDATE leads SET attempts = 1 WHERE list_id = $1 AND phone = '+16465550110'`, main.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO followups (user_id, lead_id, due_at) SELECT user_id, id, now() FROM leads WHERE list_id = $1 AND phone = '+16465550110'`, main.ID); err != nil {
			t.Fatal(err)
		}
		all, err := Lists(ctx, pool, user)
		if err != nil {
			t.Fatal(err)
		}
		if len(all) != 2 {
			t.Fatalf("lists = %+v", all)
		}
		got := map[string]List{}
		for _, l := range all {
			got[l.ID] = l
		}
		m := got[main.ID]
		if m.Called != 1 || m.Followups != 1 || m.Status() != "active" || m.ScriptID != nil {
			t.Errorf("main list = %+v", m)
		}
		if _, err := pool.Exec(ctx, `UPDATE leads SET attempts = 3 WHERE list_id = $1`, main.ID); err != nil {
			t.Fatal(err)
		}
		all, _ = Lists(ctx, pool, user)
		for _, l := range all {
			if l.ID == main.ID && l.Status() != "done" {
				t.Errorf("all called: status %q, want done", l.Status())
			}
		}
	})

	t.Run("delete", func(t *testing.T) {
		other := testdb.NewUser(t, pool)
		if err := s.Delete(ctx, other, abroad.ID); !errors.Is(err, ErrListNotFound) {
			t.Fatalf("another rep's list: %v", err)
		}
		if err := s.Delete(ctx, user, "not-a-uuid"); !errors.Is(err, ErrListNotFound) {
			t.Fatalf("bad id: %v", err)
		}
		if err := s.Delete(ctx, user, abroad.ID); err != nil {
			t.Fatal(err)
		}
		if err := s.Delete(ctx, user, abroad.ID); !errors.Is(err, ErrListNotFound) {
			t.Fatalf("deleted twice: %v", err)
		}
		// A call that is still going keeps the list.
		var callID string
		if err := pool.QueryRow(ctx, `INSERT INTO calls (user_id, lead_id, to_number, status)
			SELECT user_id, id, phone, 'answered' FROM leads WHERE list_id = $1 LIMIT 1 RETURNING id`, main.ID).Scan(&callID); err != nil {
			t.Fatal(err)
		}
		if err := s.Delete(ctx, user, main.ID); !errors.Is(err, ErrListOnCall) {
			t.Fatalf("list on a call: %v", err)
		}
		// Once it ended the list goes, and the call stays in history without its lead.
		if _, err := pool.Exec(ctx, `UPDATE calls SET status = 'ended', ended_at = now() WHERE id = $1`, callID); err != nil {
			t.Fatal(err)
		}
		if err := s.Delete(ctx, user, main.ID); err != nil {
			t.Fatalf("list with an ended call: %v", err)
		}
		var leadID *string
		if err := pool.QueryRow(ctx, `SELECT lead_id::text FROM calls WHERE id = $1`, callID).Scan(&leadID); err != nil {
			t.Fatalf("call kept: %v", err)
		}
		if leadID != nil {
			t.Errorf("call still points at deleted lead %s", *leadID)
		}
		var left int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM leads WHERE list_id = $1`, main.ID).Scan(&left); err != nil || left != 0 {
			t.Errorf("leads left after delete: %d, %v", left, err)
		}
	})
}

func TestHTTP(t *testing.T) {
	pool := testdb.Pool(t)
	s := &Service{DB: pool}
	confirmed := auth.User{ID: testdb.NewUser(t, pool), EmailConfirmed: true, PhoneConfirmed: true}
	unconfirmed := auth.User{ID: testdb.NewUser(t, pool)}
	users := map[string]auth.User{confirmed.ID: confirmed, unconfirmed.ID: unconfirmed}
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

	if status, _ := call("", http.MethodGet, "/lists", nil); status != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", status)
	}
	if status, _ := call(unconfirmed.ID, http.MethodPost, "/imports/check", map[string]any{"csv": boardFile}); status != http.StatusForbidden {
		t.Fatalf("unconfirmed upload: %d", status)
	}

	status, body := call(confirmed.ID, http.MethodPost, "/imports/check", map[string]any{"csv": boardFile})
	if status != 200 || body["rows"] != 8.0 || body["ready"] != 4.0 || body["abroad"] != 2.0 || body["problem"] != nil {
		t.Fatalf("check: %d %v", status, body)
	}
	cols := body["columns"].([]any)
	if c := cols[3].(map[string]any); c["header"] != "Phone" || c["sample"] != "(646) 555-0110" || c["field"] != "phone" {
		t.Errorf("phone column = %v", c)
	}
	if lo := body["left_out"].(map[string]any); lo["duplicate"] != 2.0 || lo["abroad"] != 2.0 || lo["dnc"] != 0.0 {
		t.Errorf("left out counts = %v", lo)
	}
	rows := body["left_out_rows"].([]any)
	if dup := rows[2].(map[string]any); dup["row"] != 6.0 || dup["name"] != "Lena Park" || dup["phone"] != "646.555.0110" || dup["same_as_row"] != 2.0 || dup["list_name"] != nil {
		t.Errorf("duplicate row = %v", dup)
	}

	status, body = call(confirmed.ID, http.MethodPost, "/imports/check", map[string]any{"csv": "Name,Sites\nLena,3\n"})
	if p, _ := body["problem"].(map[string]any); status != 200 || p["code"] != "no_phone_column" {
		t.Fatalf("no phone column: %d %v", status, body)
	}

	if status, body := call(confirmed.ID, http.MethodPost, "/imports/check", map[string]any{"csv": ""}); status != 422 || body["code"] != "empty_file" {
		t.Fatalf("empty: %d %v", status, body)
	}
	huge := strings.Repeat("\"", 3*MaxFileBytes)
	if status, body := call(confirmed.ID, http.MethodPost, "/imports/check", map[string]any{"csv": huge}); status != http.StatusRequestEntityTooLarge || body["code"] != "file_too_big" {
		t.Fatalf("huge: %d %v", status, body)
	}

	status, body = call(confirmed.ID, http.MethodPost, "/imports", map[string]any{"csv": boardFile, "mapping": boardMapping, "name": "October leads"})
	if status != http.StatusCreated {
		t.Fatalf("import: %d %v", status, body)
	}
	created := body["lists"].([]any)
	first := created[0].(map[string]any)
	if len(created) != 2 || first["name"] != "October leads" || first["lead_count"] != 4.0 || first["status"] != "new" || first["script"] != nil {
		t.Fatalf("created = %v", created)
	}

	status, body = call(confirmed.ID, http.MethodGet, "/lists", nil)
	if status != 200 || len(body["lists"].([]any)) != 2 {
		t.Fatalf("lists: %d %v", status, body)
	}

	if status, _ := call(confirmed.ID, http.MethodDelete, "/lists/"+first["id"].(string), nil); status != http.StatusNoContent {
		t.Fatalf("delete: %d", status)
	}
	if status, body := call(confirmed.ID, http.MethodDelete, "/lists/"+first["id"].(string), nil); status != 404 || body["code"] != "list_not_found" {
		t.Fatalf("delete again: %d %v", status, body)
	}
}

func phones(ls []Lead) string {
	var out []string
	for _, l := range ls {
		out = append(out, l.Phone)
	}
	return strings.Join(out, " ")
}

func equalFields(a, b []Field) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func stringsOf(rs []Reason) string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = string(r)
	}
	return strings.Join(out, " ")
}
