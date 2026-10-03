package platform

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestMustLoadConfig(t *testing.T) {
	tests := []struct {
		name      string
		env       map[string]string
		wantAddr  string
		wantEnv   string
		wantPanic bool
	}{
		{name: "defaults", wantAddr: ":8080", wantEnv: "development"},
		{name: "env overrides", env: map[string]string{"ADDR": ":9090", "ENV": "staging"}, wantAddr: ":9090", wantEnv: "staging"},
		{name: "production needs a session key", env: map[string]string{"ENV": "production"}, wantPanic: true},
		{name: "production with session key", env: map[string]string{"ENV": "production", "SESSION_KEY": "k"}, wantAddr: ":8080", wantEnv: "production"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, k := range []string{"ADDR", "ENV", "SESSION_KEY"} {
				t.Setenv(k, "") // registers restore of the original value
				os.Unsetenv(k)
			}
			for k, v := range tt.env {
				t.Setenv(k, v)
			}
			defer func() {
				if r := recover(); (r != nil) != tt.wantPanic {
					t.Fatalf("panic = %v, wantPanic %v", r, tt.wantPanic)
				}
			}()
			cfg := MustLoadConfig()
			if cfg.Addr != tt.wantAddr || cfg.Env != tt.wantEnv {
				t.Fatalf("got Addr=%q Env=%q, want Addr=%q Env=%q", cfg.Addr, cfg.Env, tt.wantAddr, tt.wantEnv)
			}
		})
	}
}

func TestLimiters(t *testing.T) {
	limiters := map[string]Limiter{"memory": NewMemoryLimiter()}
	if url := os.Getenv("CACHE_URL"); url != "" {
		c, err := OpenCache(url)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(c.Close)
		limiters["valkey"] = ValkeyLimiter{Client: c}
	}
	for name, l := range limiters {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			key := fmt.Sprintf("test:%d", time.Now().UnixNano())
			for i := 1; i <= 4; i++ {
				ok, err := l.Allow(ctx, key, 3, time.Second)
				if err != nil {
					t.Fatal(err)
				}
				if want := i <= 3; ok != want {
					t.Fatalf("try %d: allowed = %v, want %v", i, ok, want)
				}
			}
			if ok, _ := l.Allow(ctx, key+":other", 3, time.Second); !ok {
				t.Fatal("a different key should have its own count")
			}
		})
	}
}

func TestMemoryLimiterWindowResets(t *testing.T) {
	l := NewMemoryLimiter()
	now := time.Unix(0, 0)
	l.now = func() time.Time { return now }
	ctx := context.Background()
	if ok, _ := l.Allow(ctx, "k", 1, time.Minute); !ok {
		t.Fatal("first try should be allowed")
	}
	if ok, _ := l.Allow(ctx, "k", 1, time.Minute); ok {
		t.Fatal("second try in the window should be refused")
	}
	now = now.Add(time.Minute)
	if ok, _ := l.Allow(ctx, "k", 1, time.Minute); !ok {
		t.Fatal("a new window should allow again")
	}
}

func TestCORSAndRequireJSON(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := CORS([]string{"https://app.dialer.test/", " "})(RequireJSON(ok))

	tests := []struct {
		name        string
		method      string
		origin      string
		contentType string
		preflight   bool
		wantStatus  int
		wantAllow   string
	}{
		{"allowed origin", "GET", "https://app.dialer.test", "", false, http.StatusTeapot, "https://app.dialer.test"},
		{"other origin gets no CORS headers", "GET", "https://evil.test", "", false, http.StatusTeapot, ""},
		{"preflight", "OPTIONS", "https://app.dialer.test", "", true, http.StatusNoContent, "https://app.dialer.test"},
		{"JSON post", "POST", "", "application/json; charset=utf-8", false, http.StatusTeapot, ""},
		{"form post", "POST", "", "application/x-www-form-urlencoded", false, http.StatusUnsupportedMediaType, ""},
		{"no content type", "PATCH", "", "", false, http.StatusUnsupportedMediaType, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/x", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			if tt.contentType != "" {
				req.Header.Set("Content-Type", tt.contentType)
			}
			if tt.preflight {
				req.Header.Set("Access-Control-Request-Method", "POST")
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", w.Code, tt.wantStatus)
			}
			if got := w.Header().Get("Access-Control-Allow-Origin"); got != tt.wantAllow {
				t.Fatalf("allow origin = %q, want %q", got, tt.wantAllow)
			}
			if tt.wantAllow != "" && w.Header().Get("Access-Control-Allow-Credentials") != "true" {
				t.Fatal("credentials not allowed")
			}
		})
	}
}
