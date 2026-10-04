package leads

import (
	"fmt"
	"net/http"
)

// Error is a failure the rep can act on. Message is shown on screen as is.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return "leads: " + e.Code }

// Is matches errors by code, so a copy with a line number still matches.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

func unprocessable(code, message string) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: code, Message: message}
}

var (
	ErrFileTooBig     = &Error{http.StatusRequestEntityTooLarge, "file_too_big", "That file is too big. Upload up to 2 MB or 5,000 rows at a time."}
	ErrEmptyFile      = unprocessable("empty_file", "That file has no leads in it. The first row should be column names, with one lead on each row after it.")
	ErrBadCSV         = unprocessable("bad_csv", "That file couldn't be read. Save it from your spreadsheet as CSV and try again.")
	ErrTooManyRows    = unprocessable("too_many_rows", fmt.Sprintf("That file has more than %d leads. Split it into smaller files.", MaxRows))
	ErrTooManyColumns = unprocessable("too_many_columns", fmt.Sprintf("That file has more than %d columns. Remove the ones you don't need.", maxColumns))
	ErrBadMapping     = unprocessable("bad_mapping", "Pick what each column is saved as.")
	ErrFieldTwice     = unprocessable("field_twice", "Two columns are saved as the same thing. Change one of them.")
	ErrNoPhoneColumn  = unprocessable("no_phone_column", "Pick the column with the phone numbers.")
	ErrNameTwice      = unprocessable("name_twice", "Use either Full name or First and Last name, not both.")
	ErrNothingToAdd   = unprocessable("nothing_to_add", "None of these rows can be added. See the rows left out.")
	ErrBadListName    = unprocessable("invalid_name", "Give the list a name, up to 80 characters.")
	ErrListNotFound   = &Error{http.StatusNotFound, "list_not_found", "That list doesn't exist."}
	ErrListOnCall     = &Error{http.StatusConflict, "list_on_call", "You're on a call with someone on this list. Delete it after the call."}
)

func badCSV(line int) *Error {
	e := *ErrBadCSV
	e.Message = fmt.Sprintf("Line %d of that file couldn't be read. Save it from your spreadsheet as CSV and try again.", line)
	return &e
}
