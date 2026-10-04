package telephony

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
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
	// Rung lists incoming calls sent on to a browser phone, as
	// "call control id>credential id".
	Rung []string
	Fail bool
	// Now is the fake's clock for recording lengths; tests set it.
	Now func() time.Time

	recording map[string]time.Time // call control id → recording start
	outbox    []CallEvent          // events the provider would send next
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
	f.endedLocked(callControlID)
	return nil
}

func (f *FakeCalls) clock() time.Time {
	if f.Now != nil {
		return f.Now()
	}
	return time.Now()
}

func (f *FakeCalls) StartRecording(_ context.Context, callControlID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return ErrProvider
	}
	if f.recording == nil {
		f.recording = map[string]time.Time{}
	}
	if _, on := f.recording[callControlID]; !on {
		f.recording[callControlID] = f.clock()
	}
	return nil
}

// Ended tells the fake a call ended without our hanging up (the lead hung
// up): a recorded call's recording is saved, as Telnyx does.
func (f *FakeCalls) Ended(callControlID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.endedLocked(callControlID)
}

func (f *FakeCalls) endedLocked(callControlID string) {
	start, on := f.recording[callControlID]
	if !on {
		return
	}
	delete(f.recording, callControlID)
	now := f.clock()
	secs := int64(math.Ceil(now.Sub(start).Seconds()))
	f.outbox = append(f.outbox, CallEvent{
		Type: EventRecordingSaved, CallControlID: callControlID, At: now,
		RecordingURL: fmt.Sprintf("%s%d", fakeRecordingPrefix, secs), RecordingSeconds: secs,
	})
}

// Sent takes the events the fake provider has to send, oldest first. In
// development they are delivered as if they were webhooks.
func (f *FakeCalls) Sent() []CallEvent {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := f.outbox
	f.outbox = nil
	return out
}

const fakeRecordingPrefix = "fake://recording/"

// FakeRecordingMax caps the length of a fake recording's audio.
const FakeRecordingMax = 10 * 60

// FetchRecording makes the recording: a quiet 8 kHz tone as long as the
// call, as a WAV file. It needs no state, so any process can fetch it.
func (f *FakeCalls) FetchRecording(_ context.Context, source string) (Recording, error) {
	f.mu.Lock()
	fail := f.Fail
	f.mu.Unlock()
	if fail {
		return Recording{}, ErrProvider
	}
	secs, err := strconv.ParseInt(strings.TrimPrefix(source, fakeRecordingPrefix), 10, 64)
	if !strings.HasPrefix(source, fakeRecordingPrefix) || err != nil || secs < 0 {
		return Recording{}, fmt.Errorf("%w: recording address %q", ErrProvider, source)
	}
	return Recording{Body: io.NopCloser(bytes.NewReader(toneWAV(min(max(secs, 1), FakeRecordingMax)))), ContentType: "audio/wav", Ext: ".wav"}, nil
}

// toneWAV is secs seconds of a soft 440 Hz tone, 8 kHz 16-bit mono.
func toneWAV(secs int64) []byte {
	const rate = 8000
	n := int(secs) * rate
	var b bytes.Buffer
	b.Grow(44 + 2*n)
	le := binary.LittleEndian
	w32 := func(v uint32) { _ = binary.Write(&b, le, v) }
	w16 := func(v uint16) { _ = binary.Write(&b, le, v) }
	b.WriteString("RIFF")
	w32(uint32(36 + 2*n))
	b.WriteString("WAVEfmt ")
	w32(16)
	w16(1)        // PCM
	w16(1)        // mono
	w32(rate)     // sample rate
	w32(rate * 2) // bytes a second
	w16(2)        // bytes a sample
	w16(16)       // bits a sample
	b.WriteString("data")
	w32(uint32(2 * n))
	for i := range n {
		w16(uint16(int16(2000 * math.Sin(2*math.Pi*440*float64(i)/rate))))
	}
	return b.Bytes()
}

func (f *FakeCalls) Ring(_ context.Context, callControlID, credentialID, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return ErrProvider
	}
	f.Rung = append(f.Rung, callControlID+">"+credentialID)
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
	direction := "outgoing"
	if e.Incoming {
		direction = "incoming"
	}
	payload := map[string]any{
		"call_control_id": e.CallControlID, "client_state": base64.StdEncoding.EncodeToString([]byte(e.ClientState)),
		"from": e.From, "to": e.To, "hangup_cause": e.HangupCause, "direction": direction,
	}
	if e.Type == EventRecordingSaved {
		payload["recording_urls"] = map[string]string{"mp3": e.RecordingURL}
		payload["recording_started_at"] = e.At.Add(-time.Duration(e.RecordingSeconds) * time.Second).UTC().Format(time.RFC3339Nano)
		payload["recording_ended_at"] = e.At.UTC().Format(time.RFC3339Nano)
	}
	body, _ := json.Marshal(map[string]any{"data": map[string]any{
		"id": id, "event_type": string(e.Type), "occurred_at": e.At.UTC().Format(time.RFC3339Nano), "payload": payload,
	}})
	ts := strconv.FormatInt(e.At.Unix(), 10)
	h := http.Header{}
	h.Set("Telnyx-Timestamp", ts)
	h.Set("Telnyx-Signature-Ed25519", base64.StdEncoding.EncodeToString(ed25519.Sign(f.key, []byte(ts+"|"+string(body)))))
	return body, h
}
