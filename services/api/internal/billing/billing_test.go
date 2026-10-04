package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestProviderFor(t *testing.T) {
	tests := map[string]string{"NG": "paystack", "gh": "paystack", "KE": "paystack", "US": "stripe", "GB": "stripe", "": "stripe"}
	for country, want := range tests {
		if got := ProviderFor(country); got != want {
			t.Errorf("ProviderFor(%q) = %q, want %q", country, got, want)
		}
	}
}

func paystackSig(secret string, body []byte) string {
	m := hmac.New(sha512.New, []byte(secret))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

func TestPaystackWebhook(t *testing.T) {
	p := Paystack{SecretKey: "sk_test_abc"}
	success := []byte(`{"event":"charge.success","data":{"reference":"top_1","amount":2000,"currency":"usd","status":"success","authorization":{"last4":"4321","account_name":" TUNDE BAKARE "}}}`)
	transfer := []byte(`{"event":"transfer.success","data":{"reference":"tr_1"}}`)

	tests := []struct {
		name    string
		body    []byte
		sig     string
		want    Event
		wantErr error
	}{
		{"paid", success, paystackSig("sk_test_abc", success),
			Event{Kind: Paid, Reference: "top_1", AmountMinor: 2000, Currency: "USD", CardLast4: "4321", CardName: "TUNDE BAKARE"}, nil},
		{"other events are ignored", transfer, paystackSig("sk_test_abc", transfer), Event{Kind: Ignored, Reference: "tr_1"}, nil},
		{"signed with another key", success, paystackSig("sk_other", success), Event{}, ErrBadSignature},
		{"body changed after signing", append([]byte(" "), success...), paystackSig("sk_test_abc", success), Event{}, ErrBadSignature},
		{"no signature", success, "", Event{}, ErrBadSignature},
		{"signature not hex", success, "zz", Event{}, ErrBadSignature},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := http.Header{}
			h.Set("X-Paystack-Signature", tt.sig)
			got, err := p.ParseWebhook(h, tt.body)
			if !errors.Is(err, tt.wantErr) || got != tt.want {
				t.Fatalf("got %+v, %v; want %+v, %v", got, err, tt.want, tt.wantErr)
			}
		})
	}
	if _, err := (Paystack{}).ParseWebhook(http.Header{"X-Paystack-Signature": {paystackSig("", success)}}, success); !errors.Is(err, ErrBadSignature) {
		t.Fatal("an empty secret key must never accept a webhook")
	}
}

func stripeSig(secret string, ts int64, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(m, "%d.", ts)
	m.Write(body)
	return fmt.Sprintf("t=%d,v1=%s", ts, hex.EncodeToString(m.Sum(nil)))
}

func TestStripeWebhook(t *testing.T) {
	now := time.Unix(1_790_000_000, 0)
	s := Stripe{WebhookSecret: "whsec_test", Now: func() time.Time { return now }}
	completed := []byte(`{"type":"checkout.session.completed","data":{"object":{"client_reference_id":"top_2","amount_total":5000,"currency":"usd","payment_status":"paid","customer_details":{"name":"Ada Obi"}}}}`)
	unpaid := []byte(`{"type":"checkout.session.completed","data":{"object":{"client_reference_id":"top_3","amount_total":5000,"currency":"usd","payment_status":"unpaid"}}}`)
	asyncOK := []byte(`{"type":"checkout.session.async_payment_succeeded","data":{"object":{"client_reference_id":"top_3","amount_total":5000,"currency":"usd","payment_status":"paid"}}}`)
	expired := []byte(`{"type":"checkout.session.expired","data":{"object":{"client_reference_id":"top_4","amount_total":1000,"currency":"usd","payment_status":"unpaid"}}}`)
	ts := now.Unix()

	tests := []struct {
		name    string
		body    []byte
		header  string
		want    EventKind
		ref     string
		wantErr error
	}{
		{"paid", completed, stripeSig("whsec_test", ts, completed), Paid, "top_2", nil},
		{"completed but not paid yet", unpaid, stripeSig("whsec_test", ts, unpaid), Ignored, "top_3", nil},
		{"paid later (bank transfer style)", asyncOK, stripeSig("whsec_test", ts, asyncOK), Paid, "top_3", nil},
		{"expired", expired, stripeSig("whsec_test", ts, expired), Failed, "top_4", nil},
		{"two signatures, one right (secret rolling)", completed, stripeSig("whsec_old", ts, completed) + "," + stripeSig("whsec_test", ts, completed)[len(fmt.Sprintf("t=%d,", ts)):], Paid, "top_2", nil},
		{"wrong secret", completed, stripeSig("whsec_other", ts, completed), 0, "", ErrBadSignature},
		{"six minutes old (replay)", completed, stripeSig("whsec_test", ts-360, completed), 0, "", ErrBadSignature},
		{"from the future", completed, stripeSig("whsec_test", ts+360, completed), 0, "", ErrBadSignature},
		{"no timestamp", completed, "v1=abcd", 0, "", ErrBadSignature},
		{"no header", completed, "", 0, "", ErrBadSignature},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := http.Header{}
			h.Set("Stripe-Signature", tt.header)
			got, err := s.ParseWebhook(h, tt.body)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
			if err == nil && (got.Kind != tt.want || got.Reference != tt.ref) {
				t.Fatalf("got %+v, want kind %v ref %q", got, tt.want, tt.ref)
			}
		})
	}
	got, _ := s.ParseWebhook(http.Header{"Stripe-Signature": {stripeSig("whsec_test", ts, completed)}}, completed)
	if got.AmountMinor != 5000 || got.Currency != "USD" || got.CardName != "Ada Obi" {
		t.Fatalf("event = %+v", got)
	}
}

func TestPaystackCheckout(t *testing.T) {
	var body map[string]any
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		if r.URL.Path != "/transaction/initialize" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = w.Write([]byte(`{"status":true,"message":"ok","data":{"authorization_url":"https://checkout.paystack.com/abc"}}`))
	}))
	defer srv.Close()
	p := Paystack{SecretKey: "sk_test_abc", BaseURL: srv.URL}
	u, err := p.StartCheckout(context.Background(), Checkout{Reference: "top_1", Email: "a@b.test", AmountMinor: 2000, Currency: "USD", ReturnURL: "https://app.test/wallet"})
	if err != nil || u != "https://checkout.paystack.com/abc" {
		t.Fatalf("url = %q, err = %v", u, err)
	}
	if auth != "Bearer sk_test_abc" || body["amount"] != float64(2000) || body["reference"] != "top_1" || body["currency"] != "USD" {
		t.Fatalf("auth %q body %v", auth, body)
	}
}

func TestStripeCheckout(t *testing.T) {
	var form url.Values
	var idem string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		form, _ = url.ParseQuery(string(b))
		idem = r.Header.Get("Idempotency-Key")
		if r.URL.Path != "/v1/checkout/sessions" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"bad path"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"cs_test","url":"https://checkout.stripe.com/c/cs_test"}`))
	}))
	defer srv.Close()
	s := Stripe{SecretKey: "sk_test", BaseURL: srv.URL}
	u, err := s.StartCheckout(context.Background(), Checkout{Reference: "top_2", Email: "a@b.test", AmountMinor: 5000, Currency: "USD", ReturnURL: "https://app.test/ok", CancelURL: "https://app.test/no"})
	if err != nil || u != "https://checkout.stripe.com/c/cs_test" {
		t.Fatalf("url = %q, err = %v", u, err)
	}
	if form.Get("client_reference_id") != "top_2" || form.Get("line_items[0][price_data][unit_amount]") != "5000" ||
		form.Get("line_items[0][price_data][currency]") != "usd" || form.Get("mode") != "payment" || idem != "checkout-top_2" {
		t.Fatalf("form = %v, idempotency = %q", form, idem)
	}

	bad := Stripe{SecretKey: "sk_test", BaseURL: srv.URL + "/nope"}
	if _, err := bad.StartCheckout(context.Background(), Checkout{Reference: "x"}); !errors.Is(err, ErrProvider) {
		t.Fatalf("err = %v, want ErrProvider", err)
	}
}

func TestFakeRoundTrip(t *testing.T) {
	f := &Fake{Secret: "s"}
	body, h := f.Sign(Event{Kind: Paid, Reference: "r", AmountMinor: 100, Currency: "usd"})
	ev, err := f.ParseWebhook(h, body)
	if err != nil || ev.Kind != Paid || ev.Currency != "USD" {
		t.Fatalf("ev = %+v, err = %v", ev, err)
	}
	h.Set("X-Fake-Signature", "forged")
	if _, err := f.ParseWebhook(h, body); !errors.Is(err, ErrBadSignature) {
		t.Fatal("a forged fake webhook was accepted")
	}
}
