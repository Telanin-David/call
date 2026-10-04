package kyc

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
)

// Fake stands in for Smile ID in tests and development. Submitted jobs wait
// until SetResult decides them; Fail makes every call fail.
type Fake struct {
	mu      sync.Mutex
	Jobs    []Job
	results map[string]Result
	Fail    bool
}

func NewFake() *Fake { return &Fake{results: map[string]Result{}} }

func (f *Fake) Submit(_ context.Context, j Job) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return "", ErrProvider
	}
	f.Jobs = append(f.Jobs, j)
	return fmt.Sprintf("fake-smile-%d", len(f.Jobs)), nil
}

func (f *Fake) Result(_ context.Context, _, jobID string) (Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Fail {
		return Result{}, ErrProvider
	}
	return f.results[jobID], nil
}

// SetResult decides a job, as the provider would once it has checked it.
func (f *Fake) SetResult(jobID string, r Result) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r.Done = true
	f.results[jobID] = r
}

// ParseCallback takes {"user_id", "job_id"}. Only development uses the fake,
// and the result is read from Result anyway.
func (f *Fake) ParseCallback(body []byte) (string, string, error) {
	var cb struct {
		UserID string `json:"user_id"`
		JobID  string `json:"job_id"`
	}
	if err := json.Unmarshal(body, &cb); err != nil || cb.JobID == "" {
		return "", "", ErrBadSignature
	}
	return cb.UserID, cb.JobID, nil
}
