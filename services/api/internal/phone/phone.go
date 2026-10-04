// Package phone reads the phone numbers reps upload and says where they
// ring: the US and Canada, somewhere else, or a premium-rate line that is
// never called. Leads, calls and rates all use it, so a number is judged the
// same way everywhere.
package phone

import (
	"errors"
	"regexp"
	"strings"
)

// Region is where a number rings, for pricing and limits.
type Region string

const (
	// USCA is the mainland US and Canada: the plan's normal price.
	USCA Region = "us_ca"
	// Abroad is everywhere else, including the +1 Caribbean countries and US
	// territories, which cost more than the mainland.
	Abroad Region = "abroad"
)

// ErrInvalid means the text is not a phone number we can call.
var ErrInvalid = errors.New("phone: not a full phone number")

var e164 = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

// Parse reads a number as reps write it in spreadsheets and returns it in
// E.164 form. Numbers without a country code are read as US or Canada:
// "(646) 555-0110" and "1-646-555-0110" are both +16465550110. Other
// countries need their code: "+233 24 555 0190" or "00233 24 555 0190".
// An extension ("x12", "ext. 12") is dropped.
func Parse(s string) (string, error) {
	s = cutExtension(strings.TrimSpace(s))
	if strings.HasPrefix(s, "00") {
		s = "+" + s[2:]
	}
	var b strings.Builder
	for i, r := range s {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '+' && i == 0:
		case r == ' ' || r == '-' || r == '(' || r == ')' || r == '.' || r == '/' || r == ' ':
		default:
			return "", ErrInvalid
		}
	}
	digits := b.String()
	var out string
	switch {
	case strings.HasPrefix(s, "+"):
		out = "+" + digits
	case len(digits) == 10:
		out = "+1" + digits
	case len(digits) == 11 && digits[0] == '1':
		out = "+" + digits
	default:
		return "", ErrInvalid
	}
	if !e164.MatchString(out) {
		return "", ErrInvalid
	}
	if strings.HasPrefix(out, "+1") && !validNANP(out[2:]) {
		return "", ErrInvalid
	}
	return out, nil
}

// cutExtension drops "x12", "ext 12", "ext. 12" or "#12" from the end.
func cutExtension(s string) string {
	low := strings.ToLower(s)
	for _, mark := range []string{"ext", "x", "#"} {
		if i := strings.Index(low, mark); i > 0 {
			return strings.TrimSpace(s[:i])
		}
	}
	return s
}

// validNANP checks a 10-digit North American number: the area code and the
// exchange start with 2 to 9, and the area code is not a service code like 411.
func validNANP(d string) bool {
	if len(d) != 10 || d[0] < '2' || d[3] < '2' {
		return false
	}
	return d[1] != '1' || d[2] != '1'
}

// notUSCA lists the +1 area codes outside the mainland US and Canada. Calls
// to them cost far more, so they are priced and capped as abroad.
var notUSCA = map[string]bool{
	// Caribbean and Atlantic countries
	"242": true, "246": true, "264": true, "268": true, "284": true, "345": true,
	"441": true, "473": true, "649": true, "658": true, "664": true, "721": true,
	"758": true, "767": true, "784": true, "809": true, "829": true, "849": true,
	"868": true, "869": true, "876": true,
	// US territories: Virgin Islands, Puerto Rico, Northern Mariana Islands,
	// Guam, American Samoa
	"340": true, "787": true, "939": true, "670": true, "671": true, "684": true,
}

// RegionOf says where an E.164 number rings.
func RegionOf(e164 string) Region {
	if len(e164) == 12 && strings.HasPrefix(e164, "+1") && !notUSCA[e164[2:5]] {
		return USCA
	}
	return Abroad
}

// premiumPrefixes are never called: the caller pays a lot and part of it
// goes to whoever owns the line, which is how calling fraud makes money.
var premiumPrefixes = []string{
	"+1900", // US and Canada 900 numbers
	"+449",  // UK 09 numbers
	"+881",  // satellite phones
	"+882",  // international networks
	"+883",  // international networks
	"+979",  // international premium rate
}

// Premium reports whether an E.164 number is a premium-rate line.
func Premium(e164 string) bool {
	for _, p := range premiumPrefixes {
		if strings.HasPrefix(e164, p) {
			return true
		}
	}
	// North American 976 exchanges are also pay-per-call.
	return len(e164) == 12 && strings.HasPrefix(e164, "+1") && e164[5:8] == "976"
}
