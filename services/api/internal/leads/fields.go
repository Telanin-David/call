package leads

import (
	"strings"
	"unicode"

	"github.com/telanin-david/call/services/api/internal/phone"
)

// Field is what a column of the file is saved as.
type Field string

const (
	FirstName Field = "first_name"
	LastName  Field = "last_name"
	FullName  Field = "full_name" // split into first and last name
	Company   Field = "company"
	Phone     Field = "phone"
	Email     Field = "email"
	City      Field = "city"
	Notes     Field = "notes"
	Skip      Field = "skip"
)

var fields = map[Field]bool{FirstName: true, LastName: true, FullName: true, Company: true, Phone: true, Email: true, City: true, Notes: true, Skip: true}

// words that name each field in a column header, checked in this order so
// "Business Phone" is a phone and "Email Address" is an email.
var headerWords = []struct {
	field Field
	words []string
}{
	{Email, []string{"email", "e-mail", "mail"}},
	{Phone, []string{"phone", "mobile", "cell", "cellphone", "tel", "telephone", "phonenumber", "whatsapp"}},
	{FirstName, []string{"first", "firstname", "given", "fname", "forename"}},
	{LastName, []string{"last", "lastname", "surname", "family", "lname"}},
	{Company, []string{"company", "business", "organization", "organisation", "org", "employer", "firm"}},
	{City, []string{"city", "town"}},
	{Notes, []string{"note", "notes", "comment", "comments", "remarks"}},
}

var fullNameHeaders = map[string]bool{"name": true, "full name": true, "fullname": true, "contact": true, "contact name": true, "lead": true, "lead name": true}

// Suggest guesses what each column is from its header, and finds the phone
// column from the data when no header says so. Each field is used once; the
// first column that matches wins.
func Suggest(f File) []Field {
	out := make([]Field, len(f.Headers))
	used := map[Field]bool{}
	for i, h := range f.Headers {
		out[i] = Skip
		if g := guess(h); g != Skip && !used[g] {
			out[i] = g
			used[g] = true
		}
	}
	if !used[Phone] {
		if i := phoneColumn(f, out); i >= 0 {
			out[i] = Phone
		}
	}
	if used[FullName] && (used[FirstName] || used[LastName]) {
		for i := range out {
			if out[i] == FullName {
				out[i] = Skip
			}
		}
	}
	return out
}

func guess(header string) Field {
	low := strings.ToLower(strings.TrimSpace(header))
	if fullNameHeaders[low] {
		return FullName
	}
	words := strings.FieldsFunc(low, func(r rune) bool { return !unicode.IsLetter(r) && r != '-' })
	for _, hw := range headerWords {
		for _, w := range words {
			for _, want := range hw.words {
				if w == want {
					return hw.field
				}
			}
		}
	}
	return Skip
}

// phoneColumn returns the unmapped column whose first rows read best as
// phone numbers, or -1.
func phoneColumn(f File, mapped []Field) int {
	best, bestHits := -1, 0
	sample := f.Rows[:min(len(f.Rows), 20)]
	for i := range f.Headers {
		if mapped[i] != Skip {
			continue
		}
		hits := 0
		for _, r := range sample {
			if _, err := phone.Parse(r.Cell(i)); err == nil {
				hits++
			}
		}
		if hits > bestHits && hits*2 >= len(sample) {
			best, bestHits = i, hits
		}
	}
	return best
}

// checkMapping makes sure there is one field per column, each used once,
// exactly one phone column, and not both a full name and first/last names.
func checkMapping(m []Field, columns int) error {
	if len(m) != columns {
		return ErrBadMapping
	}
	seen := map[Field]bool{}
	for _, f := range m {
		if !fields[f] {
			return ErrBadMapping
		}
		if f != Skip && seen[f] {
			return ErrFieldTwice
		}
		seen[f] = true
	}
	if !seen[Phone] {
		return ErrNoPhoneColumn
	}
	if seen[FullName] && (seen[FirstName] || seen[LastName]) {
		return ErrNameTwice
	}
	return nil
}

// Lead is one row ready to save.
type Lead struct {
	Line      int
	FirstName string
	LastName  string
	Company   string
	Phone     string // E.164
	Email     string
	City      string
	Notes     string
}

// Name is how the lead is shown in lists: "Lena Park", or the company.
func (l Lead) Name() string {
	if n := strings.TrimSpace(l.FirstName + " " + l.LastName); n != "" {
		return n
	}
	return l.Company
}

// read takes a row's cells into a Lead using the mapping. raw is the phone
// as written in the file.
func read(r Row, m []Field) (l Lead, raw string) {
	l.Line = r.Line
	for i, f := range m {
		v := r.Cell(i)
		switch f {
		case FirstName:
			l.FirstName = clip(v, 100)
		case LastName:
			l.LastName = clip(v, 100)
		case FullName:
			first, last, _ := strings.Cut(strings.Join(strings.Fields(v), " "), " ")
			l.FirstName, l.LastName = clip(first, 100), clip(last, 100)
		case Company:
			l.Company = clip(v, 200)
		case Phone:
			raw = v
		case Email:
			l.Email = clip(strings.ToLower(v), 254)
		case City:
			l.City = clip(v, 100)
		case Notes:
			l.Notes = v
		}
	}
	return l, raw
}
