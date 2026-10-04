package phone

import (
	"errors"
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		in   string
		want string
		err  error
	}{
		{"(646) 555-0110", "+16465550110", nil},
		{"646.555.0110", "+16465550110", nil},
		{"6465550110", "+16465550110", nil},
		{"1-646-555-0110", "+16465550110", nil},
		{"+1 646 555 0110", "+16465550110", nil},
		{" +1 (646) 555-0110 ", "+16465550110", nil},
		{"646-555-0110 x12", "+16465550110", nil},
		{"646-555-0110 ext. 12", "+16465550110", nil},
		{"646 555 0110", "+16465550110", nil},
		{"+233 24 555 0190", "+233245550190", nil},
		{"00233 24 555 0190", "+233245550190", nil},
		{"+44 20 7946 0958", "+442079460958", nil},
		{"416-555-0123", "+14165550123", nil}, // Toronto
		{"", "", ErrInvalid},
		{"n/a", "", ErrInvalid},
		{"555-0110", "", ErrInvalid},       // no area code
		{"024 555 0190", "", ErrInvalid},   // Ghana number without its code
		{"08031234567", "", ErrInvalid},    // Nigeria number without its code
		{"6.46555E+09", "", ErrInvalid},    // spreadsheet turned it into a float
		{"1-800-FLOWERS", "", ErrInvalid},  // letters
		{"(146) 555-0110", "", ErrInvalid}, // area codes start with 2-9
		{"(646) 155-0110", "", ErrInvalid}, // exchanges start with 2-9
		{"(411) 555-0110", "", ErrInvalid}, // service code
		{"+1 646 555 011", "", ErrInvalid}, // too short for +1
		{"+12", "", ErrInvalid},
		{"646+555+0110", "", ErrInvalid},
	}
	for _, tt := range tests {
		got, err := Parse(tt.in)
		if !errors.Is(err, tt.err) || got != tt.want {
			t.Errorf("Parse(%q) = %q, %v; want %q, %v", tt.in, got, err, tt.want, tt.err)
		}
	}
}

func TestRegionOf(t *testing.T) {
	tests := []struct {
		in   string
		want Region
	}{
		{"+16465550110", USCA},
		{"+14165550123", USCA},   // Canada
		{"+18005550123", USCA},   // toll-free
		{"+18765550123", Abroad}, // Jamaica
		{"+18095550123", Abroad}, // Dominican Republic
		{"+17875550123", Abroad}, // Puerto Rico
		{"+233245550190", Abroad},
		{"+442079460958", Abroad},
	}
	for _, tt := range tests {
		if got := RegionOf(tt.in); got != tt.want {
			t.Errorf("RegionOf(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestPremium(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"+19005550123", true},
		{"+12129765555", true}, // 976 exchange
		{"+449098790000", true},
		{"+881612345678", true},
		{"+16465550110", false},
		{"+12125550976", false}, // 976 at the end is fine
		{"+442079460958", false},
	}
	for _, tt := range tests {
		if got := Premium(tt.in); got != tt.want {
			t.Errorf("Premium(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}
