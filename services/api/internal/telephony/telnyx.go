package telephony

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Telnyx is the real provider, over the Telnyx v2 REST API.
type Telnyx struct {
	APIKey string
	// ConnectionID is the voice connection new numbers and browser phones
	// are attached to, so calls reach the dialer.
	ConnectionID string
	// PublicKey (base64, from the Telnyx portal) checks call webhooks.
	PublicKey string
	// BaseURL defaults to https://api.telnyx.com/v2; tests point it elsewhere.
	BaseURL string
	Client  *http.Client
}

func (t Telnyx) base() string {
	if t.BaseURL == "" {
		return "https://api.telnyx.com/v2"
	}
	return strings.TrimRight(t.BaseURL, "/")
}

// Search calls GET /available_phone_numbers for local voice numbers in one
// area code. "Best effort" results (numbers near, not in, the area code)
// are left out.
func (t Telnyx) Search(ctx context.Context, country, areaCode string, limit int) ([]Available, error) {
	q := url.Values{}
	q.Set("filter[country_code]", country)
	q.Set("filter[national_destination_code]", areaCode)
	q.Set("filter[phone_number_type]", "local")
	q.Add("filter[features][]", "voice")
	q.Set("filter[limit]", strconv.Itoa(limit))
	var out struct {
		Data []struct {
			PhoneNumber string `json:"phone_number"`
			BestEffort  bool   `json:"best_effort"`
			Region      []struct {
				Type string `json:"region_type"`
				Name string `json:"region_name"`
			} `json:"region_information"`
			Cost struct {
				Monthly  string `json:"monthly_cost"`
				Currency string `json:"currency"`
			} `json:"cost_information"`
		} `json:"data"`
	}
	if _, err := t.do(ctx, http.MethodGet, "/available_phone_numbers?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	res := []Available{}
	for _, d := range out.Data {
		if d.BestEffort || d.Cost.Currency != "USD" {
			continue
		}
		cost, err := microDollars(d.Cost.Monthly)
		if err != nil {
			return nil, fmt.Errorf("%w: monthly cost %q", ErrProvider, d.Cost.Monthly)
		}
		var center, state string
		for _, r := range d.Region {
			switch r.Type {
			case "rate_center":
				center = titleCase(r.Name)
			case "state":
				state = r.Name
			}
		}
		city := strings.TrimSuffix(center+", "+state, ", ")
		res = append(res, Available{E164: d.PhoneNumber, City: strings.TrimPrefix(city, ", "), MonthlyCost: cost})
	}
	return res, nil
}

// Order calls POST /number_orders for one number and waits briefly for it
// to complete; US and Canada local numbers usually do at once.
func (t Telnyx) Order(ctx context.Context, e164 string) (Ordered, error) {
	body := map[string]any{"phone_numbers": []map[string]string{{"phone_number": e164}}}
	if t.ConnectionID != "" {
		body["connection_id"] = t.ConnectionID
	}
	var out struct {
		Data struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	status, err := t.do(ctx, http.MethodPost, "/number_orders", body, &out)
	if status == http.StatusUnprocessableEntity || status == http.StatusConflict {
		return Ordered{}, ErrNumberGone
	}
	if err != nil {
		return Ordered{}, err
	}
	for i := 0; out.Data.Status == "pending" && i < 10; i++ {
		select {
		case <-ctx.Done():
			return Ordered{}, ctx.Err()
		case <-time.After(time.Second):
		}
		if _, err := t.do(ctx, http.MethodGet, "/number_orders/"+url.PathEscape(out.Data.ID), nil, &out); err != nil {
			return Ordered{}, err
		}
	}
	switch out.Data.Status {
	case "success":
		return Ordered{E164: e164, ProviderID: out.Data.ID}, nil
	case "failure":
		return Ordered{}, ErrNumberGone
	}
	return Ordered{}, fmt.Errorf("%w: order %s still %q", ErrProvider, out.Data.ID, out.Data.Status)
}

// Release finds the number by its digits and calls DELETE /phone_numbers/{id}.
// A number we no longer have counts as released.
func (t Telnyx) Release(ctx context.Context, e164 string) error {
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if _, err := t.do(ctx, http.MethodGet, "/phone_numbers?"+url.Values{"filter[phone_number]": {e164}}.Encode(), nil, &out); err != nil {
		return err
	}
	for _, d := range out.Data {
		status, err := t.do(ctx, http.MethodDelete, "/phone_numbers/"+url.PathEscape(d.ID), nil, nil)
		if err != nil && status != http.StatusNotFound {
			return err
		}
	}
	return nil
}

// do sends a request and reads a JSON answer into out. It returns the HTTP
// status so callers can tell "taken" from "broken".
func (t Telnyx) do(ctx context.Context, method, path string, body, out any) (int, error) {
	status, raw, err := t.send(ctx, method, path, body)
	if err != nil {
		return status, err
	}
	if out != nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return status, fmt.Errorf("telnyx: %w: decode: %w", ErrProvider, err)
		}
	}
	return status, nil
}

// raw sends a request whose answer is plain text, like a login token.
func (t Telnyx) raw(ctx context.Context, method, path string) (string, error) {
	_, b, err := t.send(ctx, method, path, nil)
	return strings.TrimSpace(string(b)), err
}

func (t Telnyx) send(ctx context.Context, method, path string, body any) (int, []byte, error) {
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("telnyx: encode: %w", err)
		}
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, t.base()+path, r)
	if err != nil {
		return 0, nil, fmt.Errorf("telnyx: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+t.APIKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := t.Client
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("telnyx: %w: %w", ErrProvider, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("telnyx: read: %w", err)
	}
	if resp.StatusCode >= 300 {
		return resp.StatusCode, raw, fmt.Errorf("telnyx: %w: %s %s: %d %s", ErrProvider, method, strings.SplitN(path, "?", 2)[0], resp.StatusCode, firstError(raw))
	}
	return resp.StatusCode, raw, nil
}

// firstError pulls the first error title out of a Telnyx error body.
func firstError(raw []byte) string {
	var e struct {
		Errors []struct {
			Title  string `json:"title"`
			Detail string `json:"detail"`
		} `json:"errors"`
	}
	if json.Unmarshal(raw, &e) != nil || len(e.Errors) == 0 {
		return ""
	}
	return strings.TrimSpace(e.Errors[0].Title + ": " + e.Errors[0].Detail)
}

// microDollars reads "1.00" or "1.5" dollars exactly, without floats.
func microDollars(s string) (int64, error) {
	whole, frac, _ := strings.Cut(strings.TrimSpace(s), ".")
	if whole == "" || len(frac) > 6 {
		return 0, fmt.Errorf("bad amount %q", s)
	}
	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil || w < 0 {
		return 0, fmt.Errorf("bad amount %q", s)
	}
	f := int64(0)
	if frac != "" {
		f, err = strconv.ParseInt((frac + "000000")[:6], 10, 64)
		if err != nil || f < 0 {
			return 0, fmt.Errorf("bad amount %q", s)
		}
	}
	return w*1_000_000 + f, nil
}

// titleCase turns "NEW YORK" into "New York".
func titleCase(s string) string {
	words := strings.Fields(strings.ToLower(s))
	for i, w := range words {
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}
