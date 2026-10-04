package telephony

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Calls is the voice side: logins for the browser phone, ending calls, and
// reading the provider's call events.
type Calls interface {
	// Login returns a short-lived token the browser phone signs in with.
	// credentialID is the rep's provider login from before, or "" to make
	// one; save the returned id for next time.
	Login(ctx context.Context, userID, credentialID string) (token, newCredentialID string, err error)
	// Hangup ends a call. Ending a call that has already ended is not an error.
	Hangup(ctx context.Context, callControlID string) error
	// ParseEvent checks the provider's signature on a webhook, then reads it.
	ParseEvent(h http.Header, body []byte, now time.Time) (CallEvent, error)
	// Ring sends a call coming in to one of our numbers on to the rep's
	// browser phone, which rings until the rep answers it there. Events for
	// the call then carry clientState.
	Ring(ctx context.Context, callControlID, credentialID, clientState string) error
	// StartRecording records both sides of an answered call, on two
	// channels. The provider sends EventRecordingSaved after the call ends.
	StartRecording(ctx context.Context, callControlID string) error
	// FetchRecording downloads a saved recording from the address in its
	// EventRecordingSaved. The caller closes the body.
	FetchRecording(ctx context.Context, source string) (Recording, error)
}

// Recording is a saved recording being downloaded.
type Recording struct {
	Body        io.ReadCloser
	ContentType string
	// Ext is the file name ending, like ".mp3".
	Ext string
}

// EventType is what happened to a call.
type EventType string

const (
	EventInitiated EventType = "call.initiated"
	EventAnswered  EventType = "call.answered"
	EventHangup    EventType = "call.hangup"
	// EventRecordingSaved: a call's recording can be downloaded, for a
	// few minutes, from RecordingURL.
	EventRecordingSaved EventType = "call.recording.saved"
)

// CallEvent is one call webhook.
type CallEvent struct {
	ID            string // the provider's event id, for spotting repeats
	Type          EventType
	CallControlID string
	// ClientState is what the browser attached when it placed the call: our
	// call id. Empty for calls we didn't start.
	ClientState string
	From, To    string
	At          time.Time
	HangupCause string
	// Incoming is a call someone made to one of our numbers.
	Incoming bool
	// RecordingURL and RecordingSeconds come with EventRecordingSaved.
	RecordingURL     string
	RecordingSeconds int64
}

var (
	// ErrBadSignature means a webhook didn't come from the provider.
	ErrBadSignature = errors.New("telephony: bad webhook signature")
	// SignatureWindow is how old a signed webhook may be, so a copied one
	// can't be replayed later.
	SignatureWindow = 5 * time.Minute
)

// parseTelnyxEvent checks Telnyx's ed25519 signature over "timestamp|body"
// (headers telnyx-signature-ed25519 and telnyx-timestamp), then reads the
// event.
func parseTelnyxEvent(key ed25519.PublicKey, h http.Header, body []byte, now time.Time) (CallEvent, error) {
	if len(key) != ed25519.PublicKeySize {
		return CallEvent{}, ErrBadSignature
	}
	sig, err := base64.StdEncoding.DecodeString(h.Get("Telnyx-Signature-Ed25519"))
	if err != nil || len(sig) != ed25519.SignatureSize {
		return CallEvent{}, ErrBadSignature
	}
	ts := h.Get("Telnyx-Timestamp")
	secs, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return CallEvent{}, ErrBadSignature
	}
	if d := now.Sub(time.Unix(secs, 0)); d > SignatureWindow || d < -SignatureWindow {
		return CallEvent{}, ErrBadSignature
	}
	if !ed25519.Verify(key, []byte(ts+"|"+string(body)), sig) {
		return CallEvent{}, ErrBadSignature
	}

	var in struct {
		Data struct {
			ID         string    `json:"id"`
			EventType  string    `json:"event_type"`
			OccurredAt time.Time `json:"occurred_at"`
			Payload    struct {
				CallControlID string `json:"call_control_id"`
				ClientState   string `json:"client_state"`
				From          string `json:"from"`
				To            string `json:"to"`
				HangupCause   string `json:"hangup_cause"`
				Direction     string `json:"direction"`
				RecordingURLs struct {
					MP3 string `json:"mp3"`
					WAV string `json:"wav"`
				} `json:"recording_urls"`
				RecordingStartedAt *time.Time `json:"recording_started_at"`
				RecordingEndedAt   *time.Time `json:"recording_ended_at"`
			} `json:"payload"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &in); err != nil {
		return CallEvent{}, fmt.Errorf("telephony: read event: %w", err)
	}
	p := in.Data.Payload
	state := ""
	if p.ClientState != "" {
		if b, err := base64.StdEncoding.DecodeString(p.ClientState); err == nil {
			state = string(b)
		}
	}
	ev := CallEvent{
		ID: in.Data.ID, Type: EventType(in.Data.EventType), CallControlID: p.CallControlID, ClientState: state,
		From: p.From, To: p.To, At: in.Data.OccurredAt, HangupCause: p.HangupCause, Incoming: p.Direction == "incoming",
	}
	if ev.Type == EventRecordingSaved {
		ev.RecordingURL = p.RecordingURLs.MP3
		if ev.RecordingURL == "" {
			ev.RecordingURL = p.RecordingURLs.WAV
		}
		if p.RecordingStartedAt != nil && p.RecordingEndedAt != nil && p.RecordingEndedAt.After(*p.RecordingStartedAt) {
			ev.RecordingSeconds = int64(math.Ceil(p.RecordingEndedAt.Sub(*p.RecordingStartedAt).Seconds()))
		}
	}
	return ev, nil
}

// Login makes the rep a Telnyx telephony credential on the voice
// connection (once), then asks for a fresh token for it.
func (t Telnyx) Login(ctx context.Context, userID, credentialID string) (string, string, error) {
	if credentialID == "" {
		var out struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		body := map[string]string{"connection_id": t.ConnectionID, "name": "rep-" + userID}
		if _, err := t.do(ctx, http.MethodPost, "/telephony_credentials", body, &out); err != nil {
			return "", "", err
		}
		if out.Data.ID == "" {
			return "", "", fmt.Errorf("%w: no credential id", ErrProvider)
		}
		credentialID = out.Data.ID
	}
	token, err := t.raw(ctx, http.MethodPost, "/telephony_credentials/"+url.PathEscape(credentialID)+"/token")
	if err != nil {
		return "", "", err
	}
	return token, credentialID, nil
}

// Hangup calls POST /calls/{id}/actions/hangup. Telnyx answers 422 for a
// call that has already ended, which is fine.
func (t Telnyx) Hangup(ctx context.Context, callControlID string) error {
	status, err := t.do(ctx, http.MethodPost, "/calls/"+url.PathEscape(callControlID)+"/actions/hangup", map[string]any{}, nil)
	if status == http.StatusUnprocessableEntity || status == http.StatusNotFound {
		return nil
	}
	return err
}

// Ring transfers the incoming call to the rep's telephony credential, which
// rings every browser phone signed in with it. Telnyx addresses a
// credential by its SIP user name, read first.
func (t Telnyx) Ring(ctx context.Context, callControlID, credentialID, clientState string) error {
	var cred struct {
		Data struct {
			SIPUsername string `json:"sip_username"`
		} `json:"data"`
	}
	if _, err := t.do(ctx, http.MethodGet, "/telephony_credentials/"+url.PathEscape(credentialID), nil, &cred); err != nil {
		return err
	}
	if cred.Data.SIPUsername == "" {
		return fmt.Errorf("%w: no sip user name", ErrProvider)
	}
	body := map[string]string{
		"to":           "sip:" + cred.Data.SIPUsername + "@sip.telnyx.com",
		"client_state": base64.StdEncoding.EncodeToString([]byte(clientState)),
	}
	_, err := t.do(ctx, http.MethodPost, "/calls/"+url.PathEscape(callControlID)+"/actions/transfer", body, nil)
	return err
}

// StartRecording calls POST /calls/{id}/actions/record_start: an MP3 with
// the rep and the lead on separate channels, for clearer transcripts.
func (t Telnyx) StartRecording(ctx context.Context, callControlID string) error {
	body := map[string]any{"format": "mp3", "channels": "dual", "play_beep": false}
	_, err := t.do(ctx, http.MethodPost, "/calls/"+url.PathEscape(callControlID)+"/actions/record_start", body, nil)
	return err
}

// FetchRecording downloads from the presigned address in the saved event
// (it works for about 10 minutes). Only https addresses are fetched.
func (t Telnyx) FetchRecording(ctx context.Context, source string) (Recording, error) {
	u, err := url.Parse(source)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return Recording{}, fmt.Errorf("%w: recording address %q", ErrProvider, source)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return Recording{}, fmt.Errorf("telnyx: %w", err)
	}
	client := t.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute}
	}
	resp, err := client.Do(req)
	if err != nil {
		return Recording{}, fmt.Errorf("telnyx: %w: %w", ErrProvider, err)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		return Recording{}, fmt.Errorf("telnyx: %w: recording download: %d", ErrProvider, resp.StatusCode)
	}
	ext, ct := ".mp3", "audio/mpeg"
	if strings.HasSuffix(strings.ToLower(u.Path), ".wav") {
		ext, ct = ".wav", "audio/wav"
	}
	return Recording{Body: resp.Body, ContentType: ct, Ext: ext}, nil
}

// ParseEvent checks a Telnyx call webhook against PublicKey.
func (t Telnyx) ParseEvent(h http.Header, body []byte, now time.Time) (CallEvent, error) {
	key, err := base64.StdEncoding.DecodeString(t.PublicKey)
	if err != nil {
		return CallEvent{}, ErrBadSignature
	}
	return parseTelnyxEvent(key, h, body, now)
}
