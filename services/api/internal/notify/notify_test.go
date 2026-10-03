package notify

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// capture starts a server that records one request and answers with status.
func capture(t *testing.T, status int) (*httptest.Server, *map[string]any, *http.Header) {
	t.Helper()
	body := map[string]any{}
	hdr := http.Header{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hdr = r.Header.Clone()
		hdr.Set("X-Path", r.URL.Path)
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"message":"from provider"}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &body, &hdr
}

func TestResend(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		wantErr bool
	}{
		{"sent", http.StatusOK, false},
		{"refused", http.StatusUnprocessableEntity, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, body, hdr := capture(t, tt.status)
			r := Resend{APIKey: "re_test", From: "Dialer <noreply@dialer.test>", BaseURL: srv.URL}
			err := r.SendEmail(context.Background(), Email{To: "ada@example.test", Subject: "Confirm", Text: "Open the link"})
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr && !errors.Is(err, ErrProvider) {
				t.Fatalf("err = %v, want ErrProvider", err)
			}
			if hdr.Get("Authorization") != "Bearer re_test" || hdr.Get("X-Path") != "/emails" {
				t.Fatalf("auth %q path %q", hdr.Get("Authorization"), hdr.Get("X-Path"))
			}
			to, _ := (*body)["to"].([]any)
			if len(to) != 1 || to[0] != "ada@example.test" || (*body)["subject"] != "Confirm" {
				t.Fatalf("body = %v", *body)
			}
		})
	}
}

func TestTermii(t *testing.T) {
	tests := []struct {
		name        string
		channel     Channel
		status      int
		wantChannel string
		wantErr     bool
	}{
		{"sms", SMS, http.StatusOK, "generic", false},
		{"whatsapp", WhatsApp, http.StatusOK, "whatsapp", false},
		{"refused", SMS, http.StatusBadRequest, "generic", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, body, hdr := capture(t, tt.status)
			tm := Termii{APIKey: "TL_test", SenderID: "Dialer", BaseURL: srv.URL + "/"}
			err := tm.SendText(context.Background(), Text{To: "+2348031234567", Body: "Your code is 123456", Channel: tt.channel})
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			if hdr.Get("X-Path") != "/api/sms/send" {
				t.Fatalf("path = %q", hdr.Get("X-Path"))
			}
			b := *body
			if b["to"] != "2348031234567" || b["channel"] != tt.wantChannel || b["api_key"] != "TL_test" || b["from"] != "Dialer" {
				t.Fatalf("body = %v", b)
			}
		})
	}
}

func TestFakeRecordsAndFails(t *testing.T) {
	ctx := context.Background()
	f := &Fake{}
	_ = f.SendText(ctx, Text{To: "+1", Body: "one"})
	_ = f.SendText(ctx, Text{To: "+1", Body: "two"})
	if m, ok := f.LastText("+1"); !ok || m.Body != "two" {
		t.Fatalf("LastText = %v, %v", m, ok)
	}
	f.Fail = ErrProvider
	if err := f.SendEmail(ctx, Email{To: "a"}); !errors.Is(err, ErrProvider) {
		t.Fatalf("err = %v", err)
	}
	if _, ok := f.LastEmail("a"); ok {
		t.Fatal("a failed email should not be recorded")
	}
}
