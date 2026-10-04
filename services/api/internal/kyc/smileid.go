package kyc

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Smile ID's servers. The sandbox runs the same checks on test data.
const (
	SmileIDSandbox    = "https://testapi.smileidentity.com/v1"
	SmileIDProduction = "https://api.smileidentity.com/v1"
)

// docVerification is Smile ID's job type for "photo of an ID plus a selfie".
const docVerification = 6

// Smile ID image types: base64 in info.json rather than files in the zip.
const (
	imgSelfie   = 2
	imgIDFront  = 3
	imgLiveness = 6
)

// smileApproved is the result code for a verified document. Any other code
// on a finished job is a rejection; see docs/DEFERRED.md to confirm the
// codes against Smile ID's list with the sandbox key.
const smileApproved = "0810"

// SmileID is the Smile ID adapter (document verification, job type 6).
// It follows Smile ID's server-to-server flow: ask for an upload slot,
// upload a zip with info.json and the images, then read the result from
// job_status. Field names match Smile ID's own JavaScript library.
type SmileID struct {
	BaseURL     string
	PartnerID   string
	APIKey      string
	CallbackURL string
	Client      *http.Client
	Now         func() time.Time
}

func (s SmileID) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func (s SmileID) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// smileSignature is Smile ID's request signature: base64 of
// HMAC-SHA256(api key, timestamp + partner id + "sid_request").
func smileSignature(apiKey, partnerID, timestamp string) string {
	m := hmac.New(sha256.New, []byte(apiKey))
	m.Write([]byte(timestamp))
	m.Write([]byte(partnerID))
	m.Write([]byte("sid_request"))
	return base64.StdEncoding.EncodeToString(m.Sum(nil))
}

func (s SmileID) signed() (signature, timestamp string) {
	timestamp = s.now().UTC().Format("2006-01-02T15:04:05.000Z")
	return smileSignature(s.APIKey, s.PartnerID, timestamp), timestamp
}

func (s SmileID) validSignature(signature, timestamp string) bool {
	if signature == "" || timestamp == "" {
		return false
	}
	want := smileSignature(s.APIKey, s.PartnerID, timestamp)
	return hmac.Equal([]byte(want), []byte(signature))
}

type partnerParams struct {
	JobID   string `json:"job_id"`
	UserID  string `json:"user_id"`
	JobType int    `json:"job_type"`
}

func (s SmileID) post(ctx context.Context, path string, body, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.BaseURL, "/")+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := s.client().Do(req)
	if err != nil {
		return fmt.Errorf("%w: %s: %v", ErrProvider, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		return fmt.Errorf("%w: %s: %d %s", ErrProvider, path, res.StatusCode, firstLine(raw))
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%w: %s: bad reply: %v", ErrProvider, path, err)
	}
	return nil
}

func firstLine(b []byte) string {
	s := string(b)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

// Submit asks for an upload slot and uploads the job's zip.
func (s SmileID) Submit(ctx context.Context, j Job) (string, error) {
	sig, ts := s.signed()
	pp := partnerParams{JobID: j.ID, UserID: j.UserID, JobType: docVerification}
	var slot map[string]any
	err := s.post(ctx, "/upload", map[string]any{
		"callback_url": s.CallbackURL, "file_name": "selfie.zip", "model_parameters": map[string]any{},
		"partner_params": pp, "smile_client_id": s.PartnerID, "use_enrolled_image": false,
		"signature": sig, "timestamp": ts, "source_sdk": "rest_api", "source_sdk_version": "1.0.0",
	}, &slot)
	if err != nil {
		return "", err
	}
	uploadURL, _ := slot["upload_url"].(string)
	if uploadURL == "" {
		return "", fmt.Errorf("%w: no upload_url", ErrProvider)
	}
	ref, _ := slot["smile_job_id"].(string)

	images := []map[string]any{
		{"image_type_id": imgIDFront, "image": base64.StdEncoding.EncodeToString(j.IDImage), "file_name": ""},
		{"image_type_id": imgSelfie, "image": base64.StdEncoding.EncodeToString(j.Selfie), "file_name": ""},
	}
	for _, l := range j.Liveness {
		images = append(images, map[string]any{"image_type_id": imgLiveness, "image": base64.StdEncoding.EncodeToString(l), "file_name": ""})
	}
	info := map[string]any{
		"package_information": map[string]any{"apiVersion": map[string]int{"buildNumber": 0, "majorVersion": 2, "minorVersion": 0}, "language": "go"},
		"misc_information": map[string]any{
			"signature": sig, "timestamp": ts, "retry": "false", "partner_params": pp, "file_name": "selfie.zip",
			"smile_client_id": s.PartnerID, "callback_url": s.CallbackURL,
			"userData": map[string]any{"isVerifiedProcess": false, "name": "", "fbUserID": "", "firstName": "", "lastName": "", "gender": "", "email": "", "phone": "", "countryCode": "+", "countryName": ""},
		},
		"id_info":            map[string]any{"country": j.Country},
		"images":             images,
		"server_information": slot,
	}
	zipped, err := zipInfo(info)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, bytes.NewReader(zipped))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/zip")
	req.ContentLength = int64(len(zipped))
	res, err := s.client().Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: upload: %v", ErrProvider, err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<16))
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: upload: %d", ErrProvider, res.StatusCode)
	}
	return ref, nil
}

func zipInfo(info any) ([]byte, error) {
	b, err := json.Marshal(info)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("info.json")
	if err != nil {
		return nil, err
	}
	if _, err := w.Write(b); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

type smileResult struct {
	ResultCode   string            `json:"ResultCode"`
	ResultText   string            `json:"ResultText"`
	FullName     string            `json:"FullName"`
	Actions      map[string]string `json:"Actions"`
	IsFinal      any               `json:"IsFinalResult"`
	SmileJobID   string            `json:"SmileJobID"`
	PartnerParam partnerParams     `json:"PartnerParams"`
}

// Result reads a job's result from job_status. The reply is signed too, and
// an unsigned one is refused.
func (s SmileID) Result(ctx context.Context, userID, jobID string) (Result, error) {
	sig, ts := s.signed()
	var out struct {
		JobComplete bool            `json:"job_complete"`
		JobSuccess  bool            `json:"job_success"`
		Result      json.RawMessage `json:"result"`
		Signature   string          `json:"signature"`
		Timestamp   string          `json:"timestamp"`
	}
	err := s.post(ctx, "/job_status", map[string]any{
		"signature": sig, "timestamp": ts, "partner_id": s.PartnerID, "user_id": userID, "job_id": jobID,
		"image_links": false, "history": false,
	}, &out)
	if err != nil {
		return Result{}, err
	}
	if !s.validSignature(out.Signature, out.Timestamp) {
		return Result{}, fmt.Errorf("%w: job_status reply not signed", ErrBadSignature)
	}
	if !out.JobComplete {
		return Result{}, nil
	}
	var r smileResult
	// While a job runs, "result" can be a plain string; once complete it is an object.
	if len(out.Result) > 0 && out.Result[0] == '{' {
		if err := json.Unmarshal(out.Result, &r); err != nil {
			return Result{}, fmt.Errorf("%w: job_status result: %v", ErrProvider, err)
		}
	}
	res := Result{Done: true, Code: r.ResultCode, NameOnID: strings.TrimSpace(r.FullName)}
	if out.JobSuccess && r.ResultCode == smileApproved {
		res.Outcome = Approved
	} else {
		res.Outcome = Rejected
		res.Reason = r.ResultText
	}
	return res, nil
}

// ParseCallback checks the callback's signature and says which job it is
// about. Smile ID signs only the timestamp, not the body, so the callback
// is never trusted for the result: the caller reads it from job_status.
func (s SmileID) ParseCallback(body []byte) (string, string, error) {
	var cb struct {
		Signature     string        `json:"signature"`
		Timestamp     string        `json:"timestamp"`
		PartnerParams partnerParams `json:"PartnerParams"`
	}
	if err := json.Unmarshal(body, &cb); err != nil {
		return "", "", fmt.Errorf("%w: %v", ErrBadSignature, err)
	}
	if !s.validSignature(cb.Signature, cb.Timestamp) {
		return "", "", ErrBadSignature
	}
	if cb.PartnerParams.JobID == "" || cb.PartnerParams.UserID == "" {
		return "", "", fmt.Errorf("%w: no job", ErrBadSignature)
	}
	return cb.PartnerParams.UserID, cb.PartnerParams.JobID, nil
}
