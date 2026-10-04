package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The expected signatures were made with botocore 1.35 (AWS's own Python
// library) for the same keys, time and requests.
var signedAt = time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)

func testS3(endpoint string) *S3 {
	return &S3{Endpoint: endpoint, Bucket: "calls", AccessKey: "AKIDEXAMPLE", SecretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
		Region: "auto", PathStyle: true, Now: func() time.Time { return signedAt }}
}

func TestS3Presign(t *testing.T) {
	s := testS3("https://acct.r2.cloudflarestorage.com")
	got, err := s.Link("recordings/u1/c-1.mp3", 10*time.Minute, "call.mp3", signedAt)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(got)
	if u.Host != "acct.r2.cloudflarestorage.com" || u.Path != "/calls/recordings/u1/c-1.mp3" {
		t.Errorf("link = %s", got)
	}
	q := u.Query()
	want := map[string]string{
		"X-Amz-Signature":              "b403ff997d27b6ee3b82b29e674857a91899441a116db0b48dabfcd802959d07",
		"X-Amz-Credential":             "AKIDEXAMPLE/20261004/auto/s3/aws4_request",
		"X-Amz-Expires":                "600",
		"response-content-disposition": `attachment; filename="call.mp3"`,
	}
	for k, v := range want {
		if q.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, q.Get(k), v)
		}
	}
	for _, bad := range []string{"", "/abs", "a/../b", "a//b", "spa ce", `quo"te`} {
		if _, err := s.Link(bad, time.Minute, "", signedAt); !errors.Is(err, ErrBadKey) {
			t.Errorf("key %q: %v", bad, err)
		}
	}
}

type s3Server struct {
	auth, sha, ctype []string
	methods          []string
	body             string
	status           int
}

func (s *s3Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b, _ := io.ReadAll(r.Body)
	s.methods = append(s.methods, r.Method+" "+r.URL.Path)
	s.auth = append(s.auth, r.Header.Get("Authorization"))
	s.sha = append(s.sha, r.Header.Get("X-Amz-Content-Sha256"))
	s.ctype = append(s.ctype, r.Header.Get("Content-Type"))
	if r.Method == http.MethodPut {
		s.body = string(b)
	}
	if s.status != 0 {
		w.WriteHeader(s.status)
		_, _ = w.Write([]byte("<Error><Code>AccessDenied</Code></Error>"))
		return
	}
	w.WriteHeader(http.StatusOK)
}

func TestS3PutAndDelete(t *testing.T) {
	srv := &s3Server{}
	ts := httptest.NewServer(srv)
	defer ts.Close()
	s := testS3(ts.URL)
	ctx := context.Background()
	if err := s.Put(ctx, "recordings/u1/c1.mp3", strings.NewReader("abc"), 3, "audio/mpeg"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, "recordings/u1/c1.mp3"); err != nil {
		t.Fatal(err)
	}
	if srv.methods[0] != "PUT /calls/recordings/u1/c1.mp3" || srv.body != "abc" || srv.ctype[0] != "audio/mpeg" || srv.sha[0] != "UNSIGNED-PAYLOAD" {
		t.Errorf("put: %v %q %v %v", srv.methods, srv.body, srv.ctype, srv.sha)
	}
	if srv.methods[1] != "DELETE /calls/recordings/u1/c1.mp3" || srv.sha[1] != emptySHA256 {
		t.Errorf("delete: %v %v", srv.methods, srv.sha)
	}
	// Signed for the test server's host, so check the signature by
	// signing the botocore requests' host instead.
	for _, a := range srv.auth {
		if !strings.HasPrefix(a, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261004/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=") {
			t.Errorf("authorization = %s", a)
		}
	}
	srv.status = http.StatusForbidden
	if err := s.Delete(ctx, "recordings/u1/c1.mp3"); !errors.Is(err, ErrProvider) {
		t.Errorf("refused: %v", err)
	}
}

func TestS3HeaderSignatures(t *testing.T) {
	s := testS3("https://acct.r2.cloudflarestorage.com")
	for _, tt := range []struct {
		method, payload, want string
	}{
		{http.MethodPut, unsignedPayload, "c4a4b6595f181250f6b2de78f29219c7a2710626bf023ccbc5f783a2f3746be0"},
		// The same PUT with the body "abc" hashed instead.
		{http.MethodPut, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "926929b19b0cfe3afa702419230943222bc09c34094a0d2a2fa16a20e3c3b6d5"},
		{http.MethodDelete, emptySHA256, "a366af84bb47fa509faa6835c5bed0a696378a4f0e8ad7a02f58710a6129a027"},
	} {
		req, _ := http.NewRequest(tt.method, "https://acct.r2.cloudflarestorage.com/calls/recordings/u1/c1.mp3", nil)
		s.signHeaders(req, tt.payload, signedAt)
		if a := req.Header.Get("Authorization"); !strings.HasSuffix(a, "Signature="+tt.want) {
			t.Errorf("%s: %s", tt.method, a)
		}
	}
}

func TestDir(t *testing.T) {
	ctx := context.Background()
	d := &Dir{Root: t.TempDir(), Secret: []byte("k")}
	if err := d.Put(ctx, "recordings/u1/c1.wav", bytes.NewReader([]byte("RIFFdata")), 8, "audio/wav"); err != nil {
		t.Fatal(err)
	}
	link, err := d.Link("recordings/u1/c1.wav", time.Minute, "", signedAt)
	if err != nil || !strings.HasPrefix(link, DevFilesPath+"recordings/u1/c1.wav?") {
		t.Fatalf("link = %s, %v", link, err)
	}
	serve := func(link string, now time.Time) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, link, nil)
		w := httptest.NewRecorder()
		d.Serve(w, r, strings.TrimPrefix(strings.SplitN(link, "?", 2)[0], DevFilesPath), now)
		return w
	}
	if w := serve(link, signedAt); w.Code != 200 || w.Body.String() != "RIFFdata" || w.Header().Get("Content-Type") != "audio/wav" {
		t.Errorf("serve: %d %q %v", w.Code, w.Body.String(), w.Header())
	}
	if w := serve(link, signedAt.Add(2*time.Minute)); w.Code != http.StatusForbidden {
		t.Errorf("expired link: %d", w.Code)
	}
	if w := serve(strings.Replace(link, "c1.wav", "c2.wav", 1), signedAt); w.Code != http.StatusForbidden {
		t.Errorf("link for another file: %d", w.Code)
	}
	dl, _ := d.Link("recordings/u1/c1.wav", time.Minute, "call.wav", signedAt)
	if w := serve(dl, signedAt); w.Header().Get("Content-Disposition") != "attachment; filename=call.wav" {
		t.Errorf("download: %v", w.Header())
	}
	if w := serve(strings.Replace(dl, "dl=call.wav", "dl=other.wav", 1), signedAt); w.Code != http.StatusForbidden {
		t.Errorf("changed download name: %d", w.Code)
	}
	if err := d.Delete(ctx, "recordings/u1/c1.wav"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(d.Root, "recordings/u1/c1.wav")); !os.IsNotExist(err) {
		t.Error("not deleted")
	}
	if err := d.Delete(ctx, "recordings/u1/c1.wav"); err != nil {
		t.Errorf("deleting twice: %v", err)
	}
	if err := d.Put(ctx, "../escape", strings.NewReader("x"), 1, ""); !errors.Is(err, ErrBadKey) {
		t.Errorf("escape: %v", err)
	}
}
