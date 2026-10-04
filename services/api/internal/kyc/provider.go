package kyc

import (
	"context"
	"errors"
)

// Job is one ID check sent to the provider. Images are JPEG or PNG bytes.
type Job struct {
	ID      string // our verification id, sent as the provider's job id
	UserID  string
	Country string // ISO 3166 alpha-2 of the ID
	IDImage []byte
	Selfie  []byte
	// Liveness are a few more frames of the face, taken while it moves.
	Liveness [][]byte
}

// Outcome is how a check ended.
type Outcome string

const (
	Approved Outcome = "approved"
	Rejected Outcome = "rejected"
)

// Result is what the provider says about a job. Done is false while it is
// still checking.
type Result struct {
	Done    bool
	Outcome Outcome
	// Reason is the provider's words for a rejection.
	Reason string
	// NameOnID is the full name read from the ID, when the provider gives it.
	NameOnID string
	// Code is the provider's result code, kept for support.
	Code string
}

// Provider is the ID-check service. One adapter per provider; handlers
// never call it directly.
type Provider interface {
	// Submit sends a job and returns the provider's reference for it.
	Submit(ctx context.Context, j Job) (string, error)
	// Result asks the provider how a job went.
	Result(ctx context.Context, userID, jobID string) (Result, error)
	// ParseCallback checks the provider's signature on a callback and
	// returns which job it is about. The result itself is never taken
	// from the callback.
	ParseCallback(body []byte) (userID, jobID string, err error)
}

var (
	// ErrProvider is a refusal or failure from the provider.
	ErrProvider = errors.New("kyc: provider failed")
	// ErrBadSignature is a callback that the provider did not sign.
	ErrBadSignature = errors.New("kyc: bad callback signature")
)
