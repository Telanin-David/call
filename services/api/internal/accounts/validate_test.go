package accounts

import "testing"

func TestNormalizePhone(t *testing.T) {
	tests := []struct {
		in, want string
		ok       bool
	}{
		{"+234 803 123 4567", "+2348031234567", true},
		{"+1 (415) 555-0100", "+14155550100", true},
		{" +44.20.7946.0958 ", "+442079460958", true},
		{"08031234567", "08031234567", false}, // no country code
		{"+0123456789", "+0123456789", false}, // country codes don't start with 0
		{"+1234567", "+1234567", false},       // too short
		{"+1234567890123456", "", false},      // too long
		{"+234803CALLME", "", false},
		{"234+8031234567", "", false},
	}
	for _, tt := range tests {
		got, ok := NormalizePhone(tt.in)
		if ok != tt.ok || (ok && got != tt.want) {
			t.Errorf("NormalizePhone(%q) = %q, %v; want %q, %v", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func TestNormalizeEmail(t *testing.T) {
	tests := []struct {
		in, want string
		ok       bool
	}{
		{" Ada@Example.COM ", "ada@example.com", true},
		{"ada@example", "", false},
		{"Ada <ada@example.com>", "", false},
		{"no-at.example.com", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		got, ok := NormalizeEmail(tt.in)
		if ok != tt.ok || got != tt.want {
			t.Errorf("NormalizeEmail(%q) = %q, %v; want %q, %v", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func TestNormalizeNameCountryTimezone(t *testing.T) {
	if got, ok := NormalizeName("  Ada   Obi "); !ok || got != "Ada Obi" {
		t.Errorf("NormalizeName = %q, %v", got, ok)
	}
	if _, ok := NormalizeName("A"); ok {
		t.Error("one letter is not a full name")
	}
	if got, ok := NormalizeCountry(" ng "); !ok || got != "NG" {
		t.Errorf("NormalizeCountry = %q, %v", got, ok)
	}
	for _, bad := range []string{"NGA", "N1", ""} {
		if _, ok := NormalizeCountry(bad); ok {
			t.Errorf("NormalizeCountry(%q) should fail", bad)
		}
	}
	for tz, want := range map[string]bool{"Africa/Lagos": true, "UTC": true, "Lagos": false, "": false, "Local": false} {
		if got := ValidTimezone(tz); got != want {
			t.Errorf("ValidTimezone(%q) = %v, want %v", tz, got, want)
		}
	}
}
