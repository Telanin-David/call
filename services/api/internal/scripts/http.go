package scripts

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

// Routes mounts scripts for signed-in reps (Sessions.Load must run first).
func (s *Service) Routes(r chi.Router) {
	r.With(auth.RequireUser).Get("/scripts", s.handleList)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireConfirmed)
		r.Post("/scripts", s.handleCreate)
		r.Put("/scripts/{scriptID}", s.handleUpdate)
		r.Delete("/scripts/{scriptID}", s.handleDelete)
	})
}

type listRefJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type scriptJSON struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	Parts     []Part        `json:"parts"`
	Lists     []listRefJSON `json:"lists"`
	UpdatedAt time.Time     `json:"updated_at"`
}

func toJSON(sc Script) scriptJSON {
	lists := make([]listRefJSON, len(sc.Lists))
	for i, l := range sc.Lists {
		lists[i] = listRefJSON(l)
	}
	parts := sc.Parts
	if parts == nil {
		parts = []Part{}
	}
	return scriptJSON{sc.ID, sc.Name, parts, lists, sc.UpdatedAt}
}

func (s *Service) handleList(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	all, err := s.List(r.Context(), u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	until, err := FreeUntil(r.Context(), s.DB, u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	out := make([]scriptJSON, len(all))
	for i, sc := range all {
		out[i] = toJSON(sc)
	}
	var free *string
	if until != nil {
		d := until.Format("2006-01-02")
		free = &d
	}
	platform.JSON(w, http.StatusOK, map[string]any{"scripts": out, "fields": Fields, "on_screen_free_until": free})
}

type inputJSON struct {
	Name    string    `json:"name"`
	Parts   []Part    `json:"parts"`
	ListIDs *[]string `json:"list_ids"`
}

func decode(w http.ResponseWriter, r *http.Request) (Input, bool) {
	var in inputJSON
	if err := json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&in); err != nil {
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return Input{}, false
	}
	return Input(in), true
}

func (s *Service) handleCreate(w http.ResponseWriter, r *http.Request) {
	in, ok := decode(w, r)
	if !ok {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	sc, err := s.Create(r.Context(), u.ID, in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusCreated, toJSON(sc))
}

func (s *Service) handleUpdate(w http.ResponseWriter, r *http.Request) {
	in, ok := decode(w, r)
	if !ok {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	sc, err := s.Update(r.Context(), u.ID, chi.URLParam(r, "scriptID"), in)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, toJSON(sc))
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	if err := s.Delete(r.Context(), u.ID, chi.URLParam(r, "scriptID")); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
