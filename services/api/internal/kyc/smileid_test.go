package kyc

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// A stand-in for Smile ID that checks what the adapter sends, the way
// Smile ID's own library sends it.
type smileStub struct {
	t        *testing.T
	s        SmileID
	upload   map[string]any
	info     map[string]any
	complete bool
	code     string
	badSig   bool
}

func (st *smileStub) handler(srv **httptest.Server) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/upload":
			_ = json.NewDecoder(r.Body).Decode(&st.upload)
			_ = json.NewEncoder(w).Encode(map[string]any{"upload_url": (*srv).URL + "/bucket/job.zip", "smile_job_id": "0000001234", "ref_id": "r1"})
		case "/bucket/job.zip":
			if r.Method != http.MethodPut || r.Header.Get("Content-Type") != "application/zip" {
				http.Error(w, "bad upload", 400)
				return
			}
			b, _ := io.ReadAll(r.Body)
			zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
			if err != nil || len(zr.File) != 1 || zr.File[0].Name != "info.json" {
				http.Error(w, "bad zip", 400)
				return
			}
			f, _ := zr.File[0].Open()
			_ = json.NewDecoder(f).Decode(&st.info)
		case "/v1/job_status":
			var in map[string]any
			_ = json.NewDecoder(r.Body).Decode(&in)
			if !st.s.validSignature(in["signature"].(string), in["timestamp"].(string)) {
				http.Error(w, "unsigned", 401)
				return
			}
			ts := "2026-10-04T12:00:00.000Z"
			sig := smileSignature(st.s.APIKey, st.s.PartnerID, ts)
			if st.badSig {
				sig = "forged"
			}
			var result any = "Job is not complete"
			if st.complete {
				result = map[string]any{"ResultCode": st.code, "ResultText": "Document Verified", "FullName": "ADA OBI", "SmileJobID": "0000001234"}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"job_complete": st.complete, "job_success": st.code == smileApproved, "result": result, "signature": sig, "timestamp": ts})
		default:
			http.NotFound(w, r)
		}
	})
}

func TestSmileID(t *testing.T) {
	ctx := context.Background()
	st := &smileStub{t: t}
	var srv *httptest.Server
	srv = httptest.NewServer(st.handler(&srv))
	defer srv.Close()
	s := SmileID{BaseURL: srv.URL + "/v1", PartnerID: "001", APIKey: "key", CallbackURL: "https://api.dialer.test/webhooks/smileid",
		Now: func() time.Time { return time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC) }}
	st.s = s

	t.Run("signature matches Smile ID's library", func(t *testing.T) {
		// HMAC-SHA256("key", "2026-10-04T12:00:00.000Z" + "001" + "sid_request"), base64.
		if got := smileSignature("key", "001", "2026-10-04T12:00:00.000Z"); got != "nD5rG9g/uEMJghiwVnQ2YG6BV8Dw0pjvNGG9+nGHVUE=" {
			t.Errorf("signature = %s", got)
		}
	})

	t.Run("submit", func(t *testing.T) {
		ref, err := s.Submit(ctx, Job{ID: "job1", UserID: "u1", Country: "NG", IDImage: []byte{0xFF, 0xD8, 0xFF, 1}, Selfie: []byte{0xFF, 0xD8, 0xFF, 2}, Liveness: [][]byte{{0xFF, 0xD8, 0xFF, 3}}})
		if err != nil || ref != "0000001234" {
			t.Fatalf("submit = %q, %v", ref, err)
		}
		pp, _ := st.upload["partner_params"].(map[string]any)
		if pp["job_id"] != "job1" || pp["user_id"] != "u1" || pp["job_type"] != float64(6) || st.upload["smile_client_id"] != "001" ||
			st.upload["callback_url"] != "https://api.dialer.test/webhooks/smileid" || st.upload["signature"] == "" {
			t.Errorf("upload request = %v", st.upload)
		}
		imgs, _ := st.info["images"].([]any)
		types := []float64{}
		for _, i := range imgs {
			types = append(types, i.(map[string]any)["image_type_id"].(float64))
		}
		if len(types) != 3 || types[0] != 3 || types[1] != 2 || types[2] != 6 {
			t.Errorf("image types = %v, want ID (3), selfie (2), liveness (6)", types)
		}
		idInfo, _ := st.info["id_info"].(map[string]any)
		if idInfo["country"] != "NG" {
			t.Errorf("id_info = %v", idInfo)
		}
	})

	t.Run("result while running, then approved, then a forged reply", func(t *testing.T) {
		r, err := s.Result(ctx, "u1", "job1")
		if err != nil || r.Done {
			t.Fatalf("running: %+v, %v", r, err)
		}
		st.complete, st.code = true, smileApproved
		r, err = s.Result(ctx, "u1", "job1")
		if err != nil || !r.Done || r.Outcome != Approved || r.NameOnID != "ADA OBI" {
			t.Fatalf("approved: %+v, %v", r, err)
		}
		st.code = "0811"
		if r, _ := s.Result(ctx, "u1", "job1"); r.Outcome != Rejected || r.Reason != "Document Verified" {
			t.Errorf("other code: %+v", r)
		}
		st.badSig = true
		if _, err := s.Result(ctx, "u1", "job1"); !errors.Is(err, ErrBadSignature) {
			t.Errorf("forged reply: %v", err)
		}
	})

	t.Run("callback signature", func(t *testing.T) {
		ts := "2026-10-04T12:00:00.000Z"
		good, _ := json.Marshal(map[string]any{"signature": smileSignature("key", "001", ts), "timestamp": ts, "PartnerParams": map[string]any{"user_id": "u1", "job_id": "job1"}})
		if u, j, err := s.ParseCallback(good); err != nil || u != "u1" || j != "job1" {
			t.Errorf("good callback = %q %q %v", u, j, err)
		}
		bad, _ := json.Marshal(map[string]any{"signature": smileSignature("other", "001", ts), "timestamp": ts, "PartnerParams": map[string]any{"user_id": "u1", "job_id": "job1"}})
		if _, _, err := s.ParseCallback(bad); !errors.Is(err, ErrBadSignature) {
			t.Errorf("wrong key: %v", err)
		}
		if _, _, err := s.ParseCallback([]byte(`{"PartnerParams":{"job_id":"job1"}}`)); !errors.Is(err, ErrBadSignature) {
			t.Errorf("unsigned: %v", err)
		}
	})
}

func TestNameMatches(t *testing.T) {
	tests := []struct {
		account, onID string
		want          bool
	}{
		{"Ada Obi", "ADA OBI", true},
		{"Ada Obi", "OBI, ADA CHIOMA", true},
		{"Ada Obi", "ADA NWOSU", false},
		{"Ada Obi", "", true},
		{"Ada-Grace Obi", "ADA GRACE OBI", true},
		{"", "ADA OBI", false},
	}
	for _, tt := range tests {
		if got := NameMatches(tt.account, tt.onID); got != tt.want {
			t.Errorf("NameMatches(%q, %q) = %v, want %v", tt.account, tt.onID, got, tt.want)
		}
	}
}
