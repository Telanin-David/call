package leads

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

const (
	// MaxRows is the most leads one file can hold.
	MaxRows = 5000
	// MaxFileBytes is the largest file accepted, about 5,000 long rows.
	MaxFileBytes = 2 << 20
	maxColumns   = 50
	maxCellRunes = 1000
)

// File is a CSV as read: the column names and the rows under them.
type File struct {
	Headers []string
	Rows    []Row
}

// Row is one line of the file. Line is its line number in the file as a
// spreadsheet shows it (the header is line 1), so reps can find it.
type Row struct {
	Line  int
	Cells []string
}

// Cell returns column i, or "" when the row is short.
func (r Row) Cell(i int) string {
	if i < len(r.Cells) {
		return r.Cells[i]
	}
	return ""
}

// ReadCSV reads a lead file. It accepts commas, semicolons (what Excel
// writes in much of Europe and Africa) or tabs, and skips blank lines.
func ReadCSV(text string) (File, error) {
	if len(text) > MaxFileBytes {
		return File{}, ErrFileTooBig
	}
	text = strings.TrimPrefix(text, "\ufeff")
	if strings.TrimSpace(text) == "" {
		return File{}, ErrEmptyFile
	}

	r := csv.NewReader(strings.NewReader(text))
	r.Comma = delimiter(text)
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	r.ReuseRecord = false

	var f File
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			var pe *csv.ParseError
			if errors.As(err, &pe) {
				return File{}, badCSV(pe.StartLine)
			}
			return File{}, fmt.Errorf("read csv: %w", err)
		}
		line, _ := r.FieldPos(0)
		if blank(rec) {
			continue
		}
		if f.Headers == nil {
			if len(rec) > maxColumns {
				return File{}, ErrTooManyColumns
			}
			f.Headers = headers(rec)
			continue
		}
		if len(f.Rows) == MaxRows {
			return File{}, ErrTooManyRows
		}
		cells := make([]string, min(len(rec), len(f.Headers)))
		for i := range cells {
			cells[i] = clip(strings.TrimSpace(rec[i]), maxCellRunes)
		}
		f.Rows = append(f.Rows, Row{Line: line, Cells: cells})
	}
	if len(f.Rows) == 0 {
		return File{}, ErrEmptyFile
	}
	return f, nil
}

// delimiter picks the separator the first line uses most.
func delimiter(text string) rune {
	first, _, _ := strings.Cut(text, "\n")
	best, count := ',', strings.Count(first, ",")
	for _, d := range []rune{';', '\t'} {
		if n := strings.Count(first, string(d)); n > count {
			best, count = d, n
		}
	}
	return best
}

func headers(rec []string) []string {
	out := make([]string, len(rec))
	for i, h := range rec {
		h = clip(strings.Join(strings.Fields(h), " "), 60)
		if h == "" {
			h = fmt.Sprintf("Column %d", i+1)
		}
		out[i] = h
	}
	return out
}

func blank(rec []string) bool {
	for _, c := range rec {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
