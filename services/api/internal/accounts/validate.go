package accounts

import (
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var e164 = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

// NormalizePhone turns "+234 803-123 4567" into "+2348031234567". Numbers
// must include the country code.
func NormalizePhone(s string) (string, bool) {
	var b strings.Builder
	for i, r := range strings.TrimSpace(s) {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+' && i == 0:
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '(' || r == ')' || r == '.':
		default:
			return "", false
		}
	}
	out := b.String()
	return out, e164.MatchString(out)
}

// NormalizeEmail lower-cases and checks an address.
func NormalizeEmail(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) > 254 {
		return "", false
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || !strings.Contains(s[strings.LastIndex(s, "@")+1:], ".") {
		return "", false
	}
	return s, true
}

// NormalizeName trims and collapses spaces. It must look like a full name
// as on an ID: 2 to 100 characters.
func NormalizeName(s string) (string, bool) {
	s = strings.Join(strings.Fields(s), " ")
	n := utf8.RuneCountInString(s)
	return s, n >= 2 && n <= 100
}

// NormalizeCountry upper-cases an ISO 3166-1 alpha-2 code ("ng" → "NG").
func NormalizeCountry(s string) (string, bool) {
	s = strings.ToUpper(strings.TrimSpace(s))
	if len(s) != 2 || s[0] < 'A' || s[0] > 'Z' || s[1] < 'A' || s[1] > 'Z' {
		return "", false
	}
	return s, true
}

// ValidTimezone reports whether tz is an IANA zone name ("Africa/Lagos").
func ValidTimezone(tz string) bool {
	if tz == "" || tz == "Local" {
		return false
	}
	_, err := time.LoadLocation(tz)
	return err == nil
}
