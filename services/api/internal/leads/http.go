package leads

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

// maxExampleRows caps the left-out rows sent back; the counts cover the rest.
const maxExampleRows = 200

// Routes mounts lists and uploads (Sessions.Load must run first).
func (s *Service) Routes(r chi.Router) {
	r.With(auth.RequireUser).Get("/lists", s.handleLists)
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireConfirmed)
		r.Post("/imports/check", s.handleCheck)
		r.Post("/imports", s.handleImport)
		r.Delete("/lists/{listID}", s.handleDelete)
	})
}

type importRequest struct {
	CSV     string  `json:"csv"`
	Mapping []Field `json:"mapping"`
	Name    string  `json:"name"`
}

// decode reads an upload. The CSV travels inside JSON (escaped, so up to
// about twice its size) to keep the JSON-only rule that blocks cross-site
// form posts.
func decode(w http.ResponseWriter, r *http.Request) (importRequest, bool) {
	var in importRequest
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 3*MaxFileBytes)).Decode(&in)
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		platform.ErrorJSON(w, ErrFileTooBig.Status, ErrFileTooBig.Code, ErrFileTooBig.Message)
		return in, false
	case err != nil && !errors.Is(err, io.EOF):
		platform.ErrorJSON(w, http.StatusBadRequest, "bad_request", "The request couldn't be read.")
		return in, false
	}
	return in, true
}

type columnJSON struct {
	Header string `json:"header"`
	Sample string `json:"sample"`
	Field  Field  `json:"field"`
}

type leftOutJSON struct {
	Row      int     `json:"row"`
	Name     string  `json:"name"`
	Phone    string  `json:"phone"`
	Reason   Reason  `json:"reason"`
	SameAs   *int    `json:"same_as_row"`
	ListName *string `json:"list_name"`
}

func checkJSON(c Check) map[string]any {
	cols := make([]columnJSON, len(c.File.Headers))
	for i, h := range c.File.Headers {
		sample := ""
		for _, r := range c.File.Rows {
			if sample = r.Cell(i); sample != "" {
				break
			}
		}
		cols[i] = columnJSON{h, clip(sample, 80), c.Mapping[i]}
	}
	counts := map[Reason]int{Invalid: 0, Premium: 0, Duplicate: 0, DNC: 0, Listed: 0, Abroad: 0}
	examples := []leftOutJSON{}
	for _, o := range c.LeftOut {
		counts[o.Reason]++
		if len(examples) == maxExampleRows {
			continue
		}
		e := leftOutJSON{Row: o.Lead.Line, Name: o.Lead.Name(), Phone: o.RawPhone, Reason: o.Reason}
		if o.SameAs != 0 {
			e.SameAs = &o.SameAs
		}
		if o.ListName != "" {
			e.ListName = &o.ListName
		}
		examples = append(examples, e)
	}
	body := map[string]any{
		"columns":       cols,
		"rows":          len(c.File.Rows),
		"ready":         len(c.Ready),
		"abroad":        len(c.Abroad),
		"left_out":      counts,
		"left_out_rows": examples,
		"problem":       nil,
	}
	if c.Problem != nil {
		body["problem"] = map[string]string{"code": c.Problem.Code, "error": c.Problem.Message}
	}
	return body
}

func (s *Service) handleCheck(w http.ResponseWriter, r *http.Request) {
	in, ok := decode(w, r)
	if !ok {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	c, err := s.Check(r.Context(), u.ID, in.CSV, in.Mapping)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, checkJSON(c))
}

func (s *Service) handleImport(w http.ResponseWriter, r *http.Request) {
	in, ok := decode(w, r)
	if !ok {
		return
	}
	u, _ := auth.UserFrom(r.Context())
	lists, err := s.Add(r.Context(), u.ID, in.CSV, in.Mapping, in.Name)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusCreated, map[string]any{"lists": listsJSON(lists)})
}

type scriptRefJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type listJSON struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Region    string         `json:"region"`
	Status    string         `json:"status"`
	Total     int            `json:"lead_count"`
	Called    int            `json:"called_count"`
	Followups int            `json:"followup_count"`
	Script    *scriptRefJSON `json:"script"`
	CreatedAt time.Time      `json:"created_at"`
}

func listsJSON(ls []List) []listJSON {
	out := make([]listJSON, 0, len(ls))
	for _, l := range ls {
		j := listJSON{l.ID, l.Name, string(l.Region), l.Status(), l.Total, l.Called, l.Followups, nil, l.CreatedAt}
		if l.ScriptID != nil && l.ScriptName != nil {
			j.Script = &scriptRefJSON{*l.ScriptID, *l.ScriptName}
		}
		out = append(out, j)
	}
	return out
}

func (s *Service) handleLists(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	ls, err := Lists(r.Context(), s.DB, u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	platform.JSON(w, http.StatusOK, map[string]any{"lists": listsJSON(ls)})
}

func (s *Service) handleDelete(w http.ResponseWriter, r *http.Request) {
	u, _ := auth.UserFrom(r.Context())
	if err := s.Delete(r.Context(), u.ID, chi.URLParam(r, "listID")); err != nil {
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
