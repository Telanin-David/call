package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

var defaultClient = &http.Client{Timeout: 15 * time.Second}

// postJSON sends body as JSON and fails on any non-2xx answer.
func postJSON(ctx context.Context, client *http.Client, url string, headers map[string]string, body any) error {
	if client == nil {
		client = defaultClient
	}
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("send: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%w: status %d: %s", ErrProvider, resp.StatusCode, bytes.TrimSpace(msg))
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}
