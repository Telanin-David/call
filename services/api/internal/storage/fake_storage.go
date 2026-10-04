package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Dir keeps files in a folder: development and tests. Its links point at
// the api's /dev/files route and are signed like presigned S3 links, so
// they stop working when they expire.
type Dir struct {
	Root   string
	Secret []byte
}

// DevFilesPath is where the api serves Dir links (development only).
const DevFilesPath = "/dev/files/"

func (d *Dir) path(key string) (string, error) {
	if !keyOK(key) {
		return "", ErrBadKey
	}
	return filepath.Join(d.Root, filepath.FromSlash(key)), nil
}

func (d *Dir) Put(_ context.Context, key string, body io.Reader, _ int64, _ string) error {
	p, err := d.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return fmt.Errorf("storage: %w", err)
	}
	tmp := p + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("storage: %w", err)
	}
	if _, err := io.Copy(f, body); err != nil {
		_ = f.Close()
		return fmt.Errorf("storage: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("storage: %w", err)
	}
	return os.Rename(tmp, p)
}

func (d *Dir) Delete(_ context.Context, key string) error {
	p, err := d.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("storage: %w", err)
	}
	return nil
}

// Link is a path on the api: /dev/files/<key>?exp=..&dl=..&sig=..
func (d *Dir) Link(key string, ttl time.Duration, download string, now time.Time) (string, error) {
	if !keyOK(key) {
		return "", ErrBadKey
	}
	exp := strconv.FormatInt(now.Add(ttl).Unix(), 10)
	q := url.Values{"exp": {exp}, "sig": {d.mac(key, exp, download)}}
	if download != "" {
		q.Set("dl", download)
	}
	return DevFilesPath + key + "?" + q.Encode(), nil
}

func (d *Dir) mac(key, exp, download string) string {
	m := hmac.New(sha256.New, d.Secret)
	m.Write([]byte(key + "|" + exp + "|" + download))
	return hex.EncodeToString(m.Sum(nil))
}

// Serve answers a Dir link: the file if the signature is right and the
// link hasn't expired, else 403. It supports ranges, so audio can seek.
func (d *Dir) Serve(w http.ResponseWriter, r *http.Request, key string, now time.Time) {
	q := r.URL.Query()
	exp, dl := q.Get("exp"), q.Get("dl")
	at, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || now.Unix() > at || !hmac.Equal([]byte(q.Get("sig")), []byte(d.mac(key, exp, dl))) {
		http.Error(w, "This link has expired.", http.StatusForbidden)
		return
	}
	p, err := d.path(key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = f.Close() }()
	st, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if ct := contentType(p); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if dl != "" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": dl}))
	}
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "", st.ModTime(), f)
}

// contentType names audio the way browsers expect, whatever the system's
// MIME table says.
func contentType(p string) string {
	switch filepath.Ext(p) {
	case ".wav":
		return "audio/wav"
	case ".mp3":
		return "audio/mpeg"
	}
	return mime.TypeByExtension(filepath.Ext(p))
}
