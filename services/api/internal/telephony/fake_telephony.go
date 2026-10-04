package telephony

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// FakeNumbers stands in for the provider in tests and in development
// without a Telnyx key. Every area code has numbers in the 555-0100 to
// 555-0199 range, which are set aside for fiction and never ring anyone.
type FakeNumbers struct {
	mu sync.Mutex
	// Owned are the numbers ordered and not yet released.
	Owned map[string]bool
	// Taken numbers fail to order, as if someone else bought them first.
	Taken map[string]bool
	// Released lists every number given back, in order.
	Released []string
	// Fail makes every call fail, for testing provider outages.
	Fail bool
}

// fakeMonthlyCost is what the fake charges for any number: $1.00.
const fakeMonthlyCost = 1_000_000

var fakeCities = map[string]string{
	"212": "New York, NY", "646": "New York, NY", "917": "New York, NY", "718": "Brooklyn, NY",
	"213": "Los Angeles, CA", "310": "Los Angeles, CA", "305": "Miami, FL", "312": "Chicago, IL",
	"415": "San Francisco, CA", "512": "Austin, TX", "713": "Houston, TX", "404": "Atlanta, GA",
	"416": "Toronto, ON", "647": "Toronto, ON", "604": "Vancouver, BC", "514": "Montreal, QC",
}

func (f *FakeNumbers) Search(_ context.Context, country, areaCode string, limit int) ([]Available, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return nil, ErrProvider
	}
	out := []Available{}
	for i := 0; i < 100 && len(out) < limit; i++ {
		// 7 and 100 share no factor, so this visits all 100 endings once.
		n := fmt.Sprintf("+1%s55501%02d", areaCode, (42+i*7)%100)
		if f.Owned[n] || f.Taken[n] {
			continue
		}
		out = append(out, Available{E164: n, City: fakeCities[areaCode], MonthlyCost: fakeMonthlyCost})
	}
	return out, nil
}

func (f *FakeNumbers) Order(_ context.Context, e164 string) (Ordered, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return Ordered{}, ErrProvider
	}
	if f.Taken[e164] || f.Owned[e164] {
		return Ordered{}, ErrNumberGone
	}
	if f.Owned == nil {
		f.Owned = map[string]bool{}
	}
	f.Owned[e164] = true
	return Ordered{E164: e164, ProviderID: "fake-" + e164[1:], MonthlyCost: fakeMonthlyCost}, nil
}

func (f *FakeNumbers) Release(_ context.Context, e164 string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return ErrProvider
	}
	delete(f.Owned, e164)
	f.Released = append(f.Released, e164)
	return nil
}

// FakeCalls stands in for the provider's voice side. Its events are shaped
// and signed exactly like Telnyx's (ed25519), so the same checks run on
// them as on real ones.
type FakeCalls struct {
	mu   sync.Mutex
	key  ed25519.PrivateKey
	n    int
	Hung []string // call control ids hung up, in order
	Fail bool
}

// NewFakeCalls makes a fake with its own signing key.
func NewFakeCalls() *FakeCalls {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	return &FakeCalls{key: key}
}

func (f *FakeCalls) Login(_ context.Context, userID, credentialID string) (string, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return "", "", ErrProvider
	}
	if credentialID == "" {
		credentialID = "fake-cred-" + userID
	}
	f.n++
	return fmt.Sprintf("fake-token-%d", f.n), credentialID, nil
}

func (f *FakeCalls) Hangup(_ context.Context, callControlID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return ErrProvider
	}
	f.Hung = append(f.Hung, callControlID)
	return nil
}

func (f *FakeCalls) ParseEvent(h http.Header, body []byte, now time.Time) (CallEvent, error) {
	return parseTelnyxEvent(f.key.Public().(ed25519.PublicKey), h, body, now)
}

// Event builds a signed webhook for e, as Telnyx would send it at e.At.
func (f *FakeCalls) Event(e CallEvent) ([]byte, http.Header) {
	f.mu.Lock()
	f.n++
	id := fmt.Sprintf("fake-event-%d", f.n)
	f.mu.Unlock()
	if e.ID != "" {
		id = e.ID
	}
	body, _ := json.Marshal(map[string]any{"data": map[string]any{
		"id": id, "event_type": string(e.Type), "occurred_at": e.At.UTC().Format(time.RFC3339Nano),
		"payload": map[string]string{
			"call_control_id": e.CallControlID, "client_state": base64.StdEncoding.EncodeToString([]byte(e.ClientState)),
			"from": e.From, "to": e.To, "hangup_cause": e.HangupCause,
		},
	}})
	ts := strconv.FormatInt(e.At.Unix(), 10)
	h := http.Header{}
	h.Set("Telnyx-Timestamp", ts)
	h.Set("Telnyx-Signature-Ed25519", base64.StdEncoding.EncodeToString(ed25519.Sign(f.key, []byte(ts+"|"+string(body)))))
	return body, h
}
