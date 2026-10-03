package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Stripe takes cards from everywhere Paystack doesn't.
type Stripe struct {
	SecretKey     string
	WebhookSecret string // "whsec_..." from the webhook endpoint
	// BaseURL defaults to https://api.stripe.com; tests point it elsewhere.
	BaseURL string
	Client  *http.Client
	// Now is the clock for the replay window; nil means time.Now.
	Now func() time.Time
}

// stripeTolerance is how old a signed webhook may be, against replays.
const stripeTolerance = 5 * time.Minute

func (s Stripe) Name() string { return "stripe" }

// StartCheckout creates a Checkout Session and returns its URL.
func (s Stripe) StartCheckout(ctx context.Context, c Checkout) (string, error) {
	base := s.BaseURL
	if base == "" {
		base = "https://api.stripe.com"
	}
	form := url.Values{
		"mode":                    {"payment"},
		"success_url":             {c.ReturnURL},
		"cancel_url":              {c.CancelURL},
		"client_reference_id":     {c.Reference},
		"customer_email":          {c.Email},
		"payment_method_types[0]": {"card"},
		"metadata[reference]":     {c.Reference},
		"payment_intent_data[metadata][reference]":      {c.Reference},
		"line_items[0][quantity]":                       {"1"},
		"line_items[0][price_data][currency]":           {strings.ToLower(c.Currency)},
		"line_items[0][price_data][unit_amount]":        {strconv.FormatInt(c.AmountMinor, 10)},
		"line_items[0][price_data][product_data][name]": {"Dialer balance top-up"},
	}
	req, err := newRequest(ctx, strings.TrimRight(base, "/")+"/v1/checkout/sessions", strings.NewReader(form.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return "", fmt.Errorf("stripe: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.SecretKey)
	req.Header.Set("Idempotency-Key", "checkout-"+c.Reference)
	var out struct {
		URL string `json:"url"`
	}
	if err := send(s.Client, req, &out); err != nil {
		return "", fmt.Errorf("stripe: %w", err)
	}
	if out.URL == "" {
		return "", fmt.Errorf("stripe: %w: no checkout url", ErrProvider)
	}
	return out.URL, nil
}

// ParseWebhook checks the Stripe-Signature header ("t=...,v1=..."): an
// HMAC-SHA256 of "t.body" keyed with the webhook secret, no older than five
// minutes. Then it reads the checkout session events.
func (s Stripe) ParseWebhook(h http.Header, body []byte) (Event, error) {
	if err := s.verify(h.Get("Stripe-Signature"), body); err != nil {
		return Event{}, err
	}
	var ev struct {
		Type string `json:"type"`
		Data struct {
			Object struct {
				ClientReference string `json:"client_reference_id"`
				AmountTotal     int64  `json:"amount_total"`
				Currency        string `json:"currency"`
				PaymentStatus   string `json:"payment_status"`
				Customer        struct {
					Name string `json:"name"`
				} `json:"customer_details"`
			} `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &ev); err != nil {
		return Event{}, fmt.Errorf("stripe: decode webhook: %w", err)
	}
	o := ev.Data.Object
	out := Event{Reference: o.ClientReference, AmountMinor: o.AmountTotal, Currency: strings.ToUpper(o.Currency), CardName: strings.TrimSpace(o.Customer.Name)}
	switch ev.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		if o.PaymentStatus == "paid" {
			out.Kind = Paid
		}
	case "checkout.session.expired", "checkout.session.async_payment_failed":
		out.Kind = Failed
	}
	return out, nil
}

func (s Stripe) verify(header string, body []byte) error {
	if s.WebhookSecret == "" || header == "" {
		return ErrBadSignature
	}
	var ts int64
	var sigs [][]byte
	for _, part := range strings.Split(header, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch k {
		case "t":
			ts, _ = strconv.ParseInt(v, 10, 64)
		case "v1":
			if b, err := hex.DecodeString(v); err == nil {
				sigs = append(sigs, b)
			}
		}
	}
	if ts == 0 || len(sigs) == 0 {
		return ErrBadSignature
	}
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	if age := now().Sub(time.Unix(ts, 0)); age > stripeTolerance || age < -stripeTolerance {
		return ErrBadSignature
	}
	m := hmac.New(sha256.New, []byte(s.WebhookSecret))
	m.Write([]byte(strconv.FormatInt(ts, 10) + "."))
	m.Write(body)
	want := m.Sum(nil)
	for _, sig := range sigs {
		if hmac.Equal(sig, want) {
			return nil
		}
	}
	return ErrBadSignature
}
