package billing

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Paystack takes cards from Nigeria, Ghana and Kenya.
type Paystack struct {
	SecretKey string
	// BaseURL defaults to https://api.paystack.co; tests point it elsewhere.
	BaseURL string
	Client  *http.Client
}

func (p Paystack) Name() string { return "paystack" }

// StartCheckout calls POST /transaction/initialize and returns the
// authorization_url the rep pays on.
func (p Paystack) StartCheckout(ctx context.Context, c Checkout) (string, error) {
	base := p.BaseURL
	if base == "" {
		base = "https://api.paystack.co"
	}
	body, err := json.Marshal(map[string]any{
		"email":        c.Email,
		"amount":       c.AmountMinor,
		"currency":     c.Currency,
		"reference":    c.Reference,
		"callback_url": c.ReturnURL,
		"channels":     []string{"card"},
		"metadata":     map[string]string{"reference": c.Reference, "cancel_action": c.CancelURL},
	})
	if err != nil {
		return "", fmt.Errorf("paystack: encode: %w", err)
	}
	req, err := newRequest(ctx, strings.TrimRight(base, "/")+"/transaction/initialize", bytes.NewReader(body), "application/json")
	if err != nil {
		return "", fmt.Errorf("paystack: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+p.SecretKey)
	var out struct {
		Status bool   `json:"status"`
		Msg    string `json:"message"`
		Data   struct {
			URL string `json:"authorization_url"`
		} `json:"data"`
	}
	if err := send(p.Client, req, &out); err != nil {
		return "", fmt.Errorf("paystack: %w", err)
	}
	if !out.Status || out.Data.URL == "" {
		return "", fmt.Errorf("paystack: %w: %s", ErrProvider, out.Msg)
	}
	return out.Data.URL, nil
}

// ParseWebhook checks x-paystack-signature, the HMAC-SHA512 of the raw body
// keyed with the secret key, then reads charge.success.
func (p Paystack) ParseWebhook(h http.Header, body []byte) (Event, error) {
	got, err := hex.DecodeString(h.Get("X-Paystack-Signature"))
	if err != nil || len(got) == 0 || p.SecretKey == "" {
		return Event{}, ErrBadSignature
	}
	m := hmac.New(sha512.New, []byte(p.SecretKey))
	m.Write(body)
	if !hmac.Equal(got, m.Sum(nil)) {
		return Event{}, ErrBadSignature
	}

	var ev struct {
		Event string `json:"event"`
		Data  struct {
			Reference     string `json:"reference"`
			Amount        int64  `json:"amount"`
			Currency      string `json:"currency"`
			Status        string `json:"status"`
			Authorization struct {
				Last4       string `json:"last4"`
				AccountName string `json:"account_name"`
			} `json:"authorization"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &ev); err != nil {
		return Event{}, fmt.Errorf("paystack: decode webhook: %w", err)
	}
	if ev.Event != "charge.success" || ev.Data.Status != "success" {
		return Event{Kind: Ignored, Reference: ev.Data.Reference}, nil
	}
	return Event{
		Kind:        Paid,
		Reference:   ev.Data.Reference,
		AmountMinor: ev.Data.Amount,
		Currency:    strings.ToUpper(ev.Data.Currency),
		CardLast4:   ev.Data.Authorization.Last4,
		CardName:    strings.TrimSpace(ev.Data.Authorization.AccountName),
	}, nil
}
