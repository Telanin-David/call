package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

// Fake is a provider for tests and local development. Its "checkout page" is
// just a URL; Sign builds a webhook it will accept.
type Fake struct {
	ProviderName string // "paystack" or "stripe"; defaults to "fake"
	Secret       string
	// Fail makes StartCheckout fail.
	Fail error

	mu      sync.Mutex
	Started []Checkout
}

func (f *Fake) Name() string {
	if f.ProviderName == "" {
		return "fake"
	}
	return f.ProviderName
}

func (f *Fake) StartCheckout(_ context.Context, c Checkout) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail != nil {
		return "", f.Fail
	}
	f.Started = append(f.Started, c)
	return "https://pay.fake.test/" + f.Name() + "/" + c.Reference, nil
}

// fakeBody is the webhook body Fake sends and reads.
type fakeBody struct {
	Kind        EventKind `json:"kind"`
	Reference   string    `json:"reference"`
	AmountMinor int64     `json:"amount_minor"`
	Currency    string    `json:"currency"`
	CardLast4   string    `json:"card_last4"`
	CardName    string    `json:"card_name"`
}

// Sign returns a webhook body and the headers that make it valid.
func (f *Fake) Sign(e Event) ([]byte, http.Header) {
	body, _ := json.Marshal(fakeBody{e.Kind, e.Reference, e.AmountMinor, e.Currency, e.CardLast4, e.CardName})
	h := http.Header{}
	h.Set("X-Fake-Signature", f.mac(body))
	return body, h
}

func (f *Fake) ParseWebhook(h http.Header, body []byte) (Event, error) {
	got := h.Get("X-Fake-Signature")
	if f.Secret == "" || got == "" || !hmac.Equal([]byte(got), []byte(f.mac(body))) {
		return Event{}, ErrBadSignature
	}
	var b fakeBody
	if err := json.Unmarshal(body, &b); err != nil {
		return Event{}, fmt.Errorf("fake: decode webhook: %w", err)
	}
	return Event{Kind: b.Kind, Reference: b.Reference, AmountMinor: b.AmountMinor, Currency: strings.ToUpper(b.Currency), CardLast4: b.CardLast4, CardName: b.CardName}, nil
}

func (f *Fake) mac(body []byte) string {
	m := hmac.New(sha256.New, []byte(f.Secret))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}
