package kyc

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/platform"
)

// maxBody fits an ID photo, a selfie and a few face frames as base64.
const maxBody = 12 << 20

// Routes mounts the ID check for signed-in reps.
func (s *Service) Routes(r chi.Router) {
	r.With(auth.RequireUser).Get("/verification", s.handleGet)
	r.With(auth.RequireConfirmed).Post("/verification", s.handleStart)
}

// WebhookRoutes mounts the provider's callback. Its signature is checked
// first, and even then it only prompts a read of the result.
func (s *Service) WebhookRoutes(r chi.Router) {
	r.Post("/webhooks/smileid", s.handleCallback)
}

// DevRoutes lets development decide the signed-in rep's pending check:
// POST /dev/verification/approve | reject | mismatch. Only with the fake.
func (s *Service) DevRoutes(r chi.Router) {
	r.With(auth.RequireUser).Post("/dev/verification/{result}", s.handleDev)
}

type checkJSON struct {
	Status      Status     `json:"status"`
	IDType      string     `json:"id_type"`
	Country     string     `json:"country"`
	Reason      string     `json:"reason"`
	SubmittedAt *time.Time `json:"submitted_at"`
	DecidedAt   *time.Time `json:"decided_at"`
}

func toJSON(c Check) checkJSON {
	j := checkJSON{Status: c.Status, IDType: c.IDType, Country: c.Country, Reason: c.Reason, DecidedAt: c.DecidedAt}
	if c.Status != None {
		at := c.SubmittedAt
		j.SubmittedAt = &at
	}
	return j
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	c, err := s.Latest(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toJSON(c))
}

func (s *Service) handleStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDType   string   `json:"id_type"`
		Country  string   `json:"country"`
		IDImage  string   `json:"id_image"`
		Selfie   string   `json:"selfie"`
		Liveness []string `json:"liveness"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&in); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			platform.ErrorJSON(w, http.StatusRequestEntityTooLarge, "too_big", "Those photos are too big. Take them again.")
			return
		}
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	c, err := s.Start(r.Context(), u, Input(in))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusAccepted, toJSON(c))
}

func (s *Service) handleCallback(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "unreadable")
		return
	}
	if err := s.HandleCallback(r.Context(), body); err != nil {
		if errors.Is(err, ErrBadSignature) {
			platform.ErrorJSON(w, http.StatusUnauthorized, "bad_signature", "signature check failed")
			return
		}
		// Anything else: let the provider retry; the worker also catches up.
		s.log().ErrorContext(r.Context(), "id check callback", "err", err)
		platform.ErrorJSON(w, http.StatusServiceUnavailable, "retry", "try again")
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (s *Service) handleDev(w http.ResponseWriter, r *http.Request) {
	fake, ok := s.Provider.(*Fake)
	if !ok {
		platform.ErrorJSON(w, http.StatusNotFound, "not_found", "Only with the fake ID check.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	c, err := s.Latest(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if c.Status != Pending {
		platform.ErrorJSON(w, http.StatusConflict, "not_pending", "There is no check waiting.")
		return
	}
	var res Result
	switch chi.URLParam(r, "result") {
	case "approve":
		res = Result{Outcome: Approved, Code: smileApproved}
	case "mismatch":
		res = Result{Outcome: Approved, Code: smileApproved, NameOnID: "Someone Else"}
	case "reject":
		res = Result{Outcome: Rejected, Code: "0811", Reason: "Document not verified"}
	default:
		platform.ErrorJSON(w, http.StatusNotFound, "not_found", "Use approve, reject or mismatch.")
		return
	}
	fake.SetResult(c.ID, res)
	body, _ := json.Marshal(map[string]string{"user_id": u.ID, "job_id": c.ID})
	if err := s.HandleCallback(r.Context(), body); err != nil {
		s.fail(w, r, err)
		return
	}
	c, err = s.Latest(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toJSON(c))
}

func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if errors.As(err, &e) {
		platform.ErrorJSON(w, e.Status, e.Code, e.Message)
		return
	}
	s.log().ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "err", err)
	platform.ErrorJSON(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
}
