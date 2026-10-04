package telephony

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// telnyxServer answers like the Telnyx v2 API and records what was asked.
type telnyxServer struct {
	mu       sync.Mutex
	requests []string
	bodies   []string
	answers  map[string]struct {
		status int
		body   string
	}
}

func (s *telnyxServer) answer(key string, status int, body string) {
	if s.answers == nil {
		s.answers = map[string]struct {
			status int
			body   string
		}{}
	}
	s.answers[key] = struct {
		status int
		body   string
	}{status, body}
}

func (s *telnyxServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer KEY" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	b, _ := io.ReadAll(r.Body)
	s.requests = append(s.requests, r.Method+" "+r.URL.RequestURI())
	s.bodies = append(s.bodies, string(b))
	a, ok := s.answers[r.Method+" "+r.URL.Path]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(a.status)
	_, _ = w.Write([]byte(a.body))
}

func newTelnyx(t *testing.T) (*telnyxServer, Telnyx) {
	srv := &telnyxServer{}
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return srv, Telnyx{APIKey: "KEY", ConnectionID: "conn-1", BaseURL: ts.URL}
}

func TestTelnyxSearch(t *testing.T) {
	srv, tx := newTelnyx(t)
	srv.answer("GET /available_phone_numbers", 200, `{"data":[
		{"phone_number":"+16465550142","best_effort":false,
		 "region_information":[{"region_type":"rate_center","region_name":"NEW YORK"},{"region_type":"state","region_name":"NY"},{"region_type":"country_code","region_name":"US"}],
		 "cost_information":{"upfront_cost":"1.00","monthly_cost":"1.00","currency":"USD"}},
		{"phone_number":"+12015550100","best_effort":true,
		 "region_information":[{"region_type":"state","region_name":"NJ"}],
		 "cost_information":{"monthly_cost":"1.00","currency":"USD"}},
		{"phone_number":"+16465550199","best_effort":false,
		 "region_information":[],
		 "cost_information":{"monthly_cost":"2.5","currency":"USD"}}
	]}`)
	got, err := tx.Search(context.Background(), "US", "646", 10)
	if err != nil {
		t.Fatal(err)
	}
	want := []Available{{"+16465550142", "New York, NY", 1_000_000}, {"+16465550199", "", 2_500_000}}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("Search = %+v, want %+v (best-effort numbers left out)", got, want)
	}
	q := srv.requests[0]
	for _, part := range []string{"filter%5Bcountry_code%5D=US", "filter%5Bnational_destination_code%5D=646", "filter%5Bphone_number_type%5D=local", "filter%5Bfeatures%5D%5B%5D=voice", "filter%5Blimit%5D=10"} {
		if !strings.Contains(q, part) {
			t.Errorf("search request %q is missing %s", q, part)
		}
	}
}

func TestTelnyxOrder(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		srv, tx := newTelnyx(t)
		srv.answer("POST /number_orders", 200, `{"data":{"id":"order-1","status":"success","phone_numbers":[{"id":"x","phone_number":"+16465550142","status":"success"}]}}`)
		got, err := tx.Order(context.Background(), "+16465550142")
		if err != nil || got.ProviderID != "order-1" || got.E164 != "+16465550142" {
			t.Fatalf("Order = %+v, %v", got, err)
		}
		var body map[string]any
		_ = json.Unmarshal([]byte(srv.bodies[0]), &body)
		if body["connection_id"] != "conn-1" || !strings.Contains(srv.bodies[0], `"phone_number":"+16465550142"`) {
			t.Errorf("order body = %s", srv.bodies[0])
		}
	})
	t.Run("taken", func(t *testing.T) {
		srv, tx := newTelnyx(t)
		srv.answer("POST /number_orders", 422, `{"errors":[{"title":"Number not available","detail":"..."}]}`)
		if _, err := tx.Order(context.Background(), "+16465550142"); !errors.Is(err, ErrNumberGone) {
			t.Fatalf("taken number: %v", err)
		}
	})
	t.Run("failed order", func(t *testing.T) {
		srv, tx := newTelnyx(t)
		srv.answer("POST /number_orders", 200, `{"data":{"id":"order-2","status":"failure"}}`)
		if _, err := tx.Order(context.Background(), "+16465550142"); !errors.Is(err, ErrNumberGone) {
			t.Fatalf("failed order: %v", err)
		}
	})
	t.Run("server error", func(t *testing.T) {
		srv, tx := newTelnyx(t)
		srv.answer("POST /number_orders", 500, `{"errors":[{"title":"Internal error"}]}`)
		_, err := tx.Order(context.Background(), "+16465550142")
		if !errors.Is(err, ErrProvider) || errors.Is(err, ErrNumberGone) || !strings.Contains(err.Error(), "Internal error") {
			t.Fatalf("server error: %v", err)
		}
	})
	t.Run("wrong key", func(t *testing.T) {
		_, tx := newTelnyx(t)
		tx.APIKey = "nope"
		if _, err := tx.Order(context.Background(), "+16465550142"); !errors.Is(err, ErrProvider) {
			t.Fatalf("wrong key: %v", err)
		}
	})
}

func TestTelnyxRelease(t *testing.T) {
	srv, tx := newTelnyx(t)
	srv.answer("GET /phone_numbers", 200, `{"data":[{"id":"pn-9","phone_number":"+16465550142"}]}`)
	srv.answer("DELETE /phone_numbers/pn-9", 200, `{"data":{"id":"pn-9"}}`)
	if err := tx.Release(context.Background(), "+16465550142"); err != nil {
		t.Fatal(err)
	}
	if len(srv.requests) != 2 || srv.requests[0] != "GET /phone_numbers?filter%5Bphone_number%5D=%2B16465550142" || srv.requests[1] != "DELETE /phone_numbers/pn-9" {
		t.Fatalf("requests = %v", srv.requests)
	}

	srv2, tx2 := newTelnyx(t)
	srv2.answer("GET /phone_numbers", 200, `{"data":[]}`)
	if err := tx2.Release(context.Background(), "+16465550142"); err != nil {
		t.Fatalf("a number we no longer have counts as released: %v", err)
	}
}

func TestMicroDollars(t *testing.T) {
	tests := []struct {
		in   string
		want int64
		bad  bool
	}{
		{"1.00", 1_000_000, false}, {"1.5", 1_500_000, false}, {"0.004", 4_000, false}, {"12", 12_000_000, false},
		{"", 0, true}, {"-1.00", 0, true}, {"1.0000001", 0, true}, {"abc", 0, true}, {".50", 0, true},
	}
	for _, tt := range tests {
		got, err := microDollars(tt.in)
		if (err != nil) != tt.bad || got != tt.want {
			t.Errorf("microDollars(%q) = %d, %v", tt.in, got, err)
		}
	}
	if got := titleCase("NEW  YORK"); got != "New York" {
		t.Errorf("titleCase = %q", got)
	}
}

func TestFakeNumbers(t *testing.T) {
	ctx := context.Background()
	f := &FakeNumbers{Taken: map[string]bool{"+16465550142": true}}
	got, err := f.Search(ctx, "US", "646", 6)
	if err != nil || len(got) != 6 || got[0].E164 != "+16465550149" || got[0].City != "New York, NY" {
		t.Fatalf("Search = %+v, %v (the taken first number is skipped)", got, err)
	}
	seen := map[string]bool{}
	all, _ := f.Search(ctx, "US", "646", 100)
	for _, a := range all {
		seen[a.E164] = true
	}
	if len(all) != 99 || len(seen) != 99 {
		t.Fatalf("100 fictional endings minus the taken one, all different: got %d (%d unique)", len(all), len(seen))
	}
	if _, err := f.Order(ctx, got[0].E164); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Order(ctx, got[0].E164); !errors.Is(err, ErrNumberGone) {
		t.Fatalf("ordering twice: %v", err)
	}
	if _, err := f.Order(ctx, "+16465550142"); !errors.Is(err, ErrNumberGone) {
		t.Fatalf("taken: %v", err)
	}
	_ = f.Release(ctx, got[0].E164)
	if f.Owned[got[0].E164] || len(f.Released) != 1 {
		t.Fatalf("release: owned %v released %v", f.Owned, f.Released)
	}
}
