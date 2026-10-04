package recordings

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/telanin-david/call/services/api/internal/auth"
	"github.com/telanin-david/call/services/api/internal/platform"
	"github.com/telanin-david/call/services/api/internal/storage"
)

// Routes mounts recordings for signed-in reps (Sessions.Load must run first).
func (s *Service) Routes(r chi.Router) {
	r.With(auth.RequireUser).Get("/recordings/settings", s.handleSetting)
	r.With(auth.RequireUser).Get("/recordings/{callID}", s.handleGet)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireConfirmed)
		r.Put("/recordings/settings", s.handleSetSetting)
		r.Delete("/recordings/{callID}", s.handleDelete)
	})
}

// DevRoutes serves files kept in a local folder (development without S3).
// The links are signed and expire, like presigned S3 links.
func (s *Service) DevRoutes(r chi.Router) {
	dir, ok := s.Store.(*storage.Dir)
	if !ok {
		return
	}
	r.Get(storage.DevFilesPath+"*", func(w http.ResponseWriter, r *http.Request) {
		dir.Serve(w, r, strings.TrimPrefix(r.URL.Path, storage.DevFilesPath), s.now())
	})
}

type settingJSON struct {
	On        bool       `json:"on"`
	AgreedAt  *time.Time `json:"agreed_at"`
	Pro       bool       `json:"pro"`
	Available bool       `json:"available"`
}

func settingOut(st Setting) settingJSON { return settingJSON(st) }

func (s *Service) handleSetting(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	st, err := s.Setting(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, settingOut(st))
}

func (s *Service) handleSetSetting(w http.ResponseWriter, r *http.Request) {
	var in struct {
		On bool `json:"on"`
		// Agree: the rep will tell every lead the call may be recorded.
		Agree bool `json:"agree"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return
	}
	u, _ := auth.UserFrom(r.Context())
	st, err := s.SetRecording(r.Context(), u.ID, in.On, in.Agree)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, settingOut(st))
}

type recordingJSON struct {
	CallID      string     `json:"call_id"`
	Status      string     `json:"status"`
	Seconds     int64      `json:"seconds"`
	URL         *string    `json:"url"`
	DownloadURL *string    `json:"download_url"`
	KeepUntil   *time.Time `json:"keep_until"`
	Call        struct {
		LeadID      *string   `json:"lead_id"`
		LeadName    string    `json:"lead_name"`
		LeadCompany string    `json:"lead_company"`
		To          string    `json:"to"`
		Incoming    bool      `json:"incoming"`
		StartedAt   time.Time `json:"started_at"`
		Seconds     int64     `json:"seconds"`
		Cost        int64     `json:"cost_microdollars"`
		Outcome     *string   `json:"outcome"`
		Note        string    `json:"note"`
	} `json:"call"`
}

func opt(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (s *Service) handleGet(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	rec, err := s.Get(r.Context(), u.ID, chi.URLParam(r, "callID"))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := recordingJSON{CallID: rec.CallID, Status: rec.Status, Seconds: rec.Seconds, URL: opt(rec.URL), DownloadURL: opt(rec.DownloadURL), KeepUntil: rec.KeepUntil}
	c := rec.Call
	out.Call.LeadID, out.Call.LeadName, out.Call.LeadCompany, out.Call.To = opt(c.LeadID), c.LeadName, c.LeadCompany, c.To
	out.Call.Incoming, out.Call.StartedAt, out.Call.Seconds, out.Call.Cost = c.Incoming, c.StartedAt, c.Seconds, c.Cost
	out.Call.Outcome, out.Call.Note = opt(c.Outcome), c.Note
	// Links are secrets that expire: never cache the answer.
	w.Header().Set("Cache-Control", "no-store")
	platform.JSON(w, http.StatusOK, out)
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	if err := s.Delete(r.Context(), u.ID, chi.URLParam(r, "callID")); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if errors.As(err, &e) {
		platform.JSON(w, e.Status, map[string]string{"code": e.Code, "error": e.Message, "action": e.Action})
		return
	}
	s.log().ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "err", err)
	platform.ErrorJSON(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again.")
}
