package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

var defaultClient = &http.Client{Timeout: 20 * time.Second}

// send performs req and decodes a 2xx JSON answer into out.
func send(client *http.Client, req *http.Request, out any) error {
	if client == nil {
		client = defaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("send: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read: %w", err)
	}
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%w: status %d: %s", ErrProvider, resp.StatusCode, bytes.TrimSpace(trim(body, 300)))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return nil
}

func newRequest(ctx context.Context, url string, body io.Reader, contentType string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return nil, fmt.Errorf("request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	return req, nil
}

func trim(b []byte, n int) []byte {
	if len(b) > n {
		return b[:n]
	}
	return b
}
