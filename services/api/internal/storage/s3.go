package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// S3 is an S3-compatible store (Cloudflare R2), signed with AWS Signature
// Version 4. R2 encrypts every file at rest.
type S3 struct {
	// Endpoint is the store's address, like
	// https://<account>.r2.cloudflarestorage.com.
	Endpoint  string
	Bucket    string
	AccessKey string
	SecretKey string
	// Region is "auto" on R2.
	Region string
	// PathStyle puts the bucket in the path (R2) instead of the host name.
	PathStyle bool
	Client    *http.Client
	// Now is the clock for signed requests; tests set it.
	Now func() time.Time
}

const (
	unsignedPayload = "UNSIGNED-PAYLOAD"
	emptySHA256     = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	amzDateFormat   = "20060102T150405Z"
)

func (s *S3) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *S3) region() string {
	if s.Region == "" {
		return "auto"
	}
	return s.Region
}

// objectURL is the file's address, unsigned.
func (s *S3) objectURL(key string) (*url.URL, error) {
	if !keyOK(key) {
		return nil, ErrBadKey
	}
	u, err := url.Parse(strings.TrimRight(s.Endpoint, "/"))
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("storage: endpoint %q: %w", s.Endpoint, ErrProvider)
	}
	if s.PathStyle {
		u.Path = "/" + s.Bucket + "/" + key
	} else {
		u.Host = s.Bucket + "." + u.Host
		u.Path = "/" + key
	}
	return u, nil
}

func (s *S3) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	u, err := s.objectURL(key)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), body)
	if err != nil {
		return fmt.Errorf("storage: %w", err)
	}
	req.ContentLength = size
	req.Header.Set("Content-Type", contentType)
	return s.do(req, unsignedPayload)
}

func (s *S3) Delete(ctx context.Context, key string) error {
	u, err := s.objectURL(key)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u.String(), nil)
	if err != nil {
		return fmt.Errorf("storage: %w", err)
	}
	return s.do(req, emptySHA256)
}

func (s *S3) do(req *http.Request, payload string) error {
	s.signHeaders(req, payload, s.now())
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Minute}
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("storage: %w: %w", ErrProvider, err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	// S3 answers 204 to a delete, also for a file that isn't there.
	if resp.StatusCode >= 300 {
		return fmt.Errorf("storage: %w: %s %s: %d %s", ErrProvider, req.Method, req.URL.Path, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	return nil
}

// signHeaders adds the Authorization header for a request signed on its
// host, x-amz-content-sha256 and x-amz-date.
func (s *S3) signHeaders(req *http.Request, payload string, now time.Time) {
	amzDate := now.UTC().Format(amzDateFormat)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payload)
	headers := map[string]string{"host": req.URL.Host, "x-amz-content-sha256": payload, "x-amz-date": amzDate}
	scope, sig, signed := s.sign(req.Method, req.URL, req.URL.Query(), headers, payload, now)
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s", s.AccessKey, scope, signed, sig))
}

// Link presigns a GET for the file, valid for ttl (at most 7 days).
func (s *S3) Link(key string, ttl time.Duration, download string, now time.Time) (string, error) {
	u, err := s.objectURL(key)
	if err != nil {
		return "", err
	}
	amzDate := now.UTC().Format(amzDateFormat)
	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", s.AccessKey+"/"+s.scope(now))
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", strconv.Itoa(int(ttl/time.Second)))
	q.Set("X-Amz-SignedHeaders", "host")
	if download != "" {
		q.Set("response-content-disposition", `attachment; filename="`+download+`"`)
	}
	_, sig, _ := s.sign(http.MethodGet, u, q, map[string]string{"host": u.Host}, unsignedPayload, now)
	q.Set("X-Amz-Signature", sig)
	u.RawQuery = canonicalQuery(q)
	return u.String(), nil
}

func (s *S3) scope(now time.Time) string {
	return now.UTC().Format("20060102") + "/" + s.region() + "/s3/aws4_request"
}

// sign is Signature Version 4: it returns the credential scope, the
// signature and the signed header names.
func (s *S3) sign(method string, u *url.URL, q url.Values, headers map[string]string, payload string, now time.Time) (string, string, string) {
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	sort.Strings(names)
	var ch strings.Builder
	for _, k := range names {
		ch.WriteString(k + ":" + strings.TrimSpace(headers[k]) + "\n")
	}
	signed := strings.Join(names, ";")
	canonical := strings.Join([]string{method, escapePath(u.Path), canonicalQuery(q), ch.String(), signed, payload}, "\n")
	scope := s.scope(now)
	sum := sha256.Sum256([]byte(canonical))
	toSign := "AWS4-HMAC-SHA256\n" + now.UTC().Format(amzDateFormat) + "\n" + scope + "\n" + hex.EncodeToString(sum[:])
	key := hmacSHA256([]byte("AWS4"+s.SecretKey), now.UTC().Format("20060102"))
	key = hmacSHA256(key, s.region())
	key = hmacSHA256(key, "s3")
	key = hmacSHA256(key, "aws4_request")
	return scope, hex.EncodeToString(hmacSHA256(key, toSign)), signed
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

// canonicalQuery sorts by name and escapes names and values as SigV4 wants.
func canonicalQuery(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := []string{}
	for _, k := range keys {
		vals := append([]string{}, q[k]...)
		sort.Strings(vals)
		for _, v := range vals {
			parts = append(parts, escape(k)+"="+escape(v))
		}
	}
	return strings.Join(parts, "&")
}

// escapePath escapes each path segment, keeping the slashes.
func escapePath(p string) string {
	segs := strings.Split(p, "/")
	for i, seg := range segs {
		segs[i] = escape(seg)
	}
	return strings.Join(segs, "/")
}

// escape is RFC 3986 percent-encoding: everything but A-Z a-z 0-9 - _ . ~.
func escape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// keyOK allows plain relative paths of letters, digits and - _ . /.
func keyOK(key string) bool {
	if key == "" || len(key) > 512 || strings.HasPrefix(key, "/") || strings.Contains(key, "..") || strings.Contains(key, "//") {
		return false
	}
	for _, r := range key {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' || r == '/') {
			return false
		}
	}
	return true
}
