package phone

import (
	"reflect"
	"testing"
	"time"
)

func TestTimeZones(t *testing.T) {
	tests := []struct {
		in   string
		want []string
	}{
		{"+16465550110", []string{"America/New_York"}},
		{"+12135550199", []string{"America/Los_Angeles"}},
		{"+13125550187", []string{"America/Chicago"}},
		{"+14165550123", []string{"America/Toronto"}},
		{"+18085550123", []string{"Pacific/Honolulu"}},
		{"+19075550123", []string{"America/Adak", "America/Anchorage"}},
		{"+18765550123", []string{"America/Jamaica"}},
		{"+233245550190", []string{"Africa/Accra"}},
		{"+1", nil}, // the whole country says nothing
		{"", nil},
	}
	for _, tt := range tests {
		if got := TimeZones(tt.in); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("TimeZones(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestInCallingHours(t *testing.T) {
	// 4 Oct 2026, 13:00 UTC is 9 am in New York, 6 am in Los Angeles,
	// 3 am in Honolulu, 5 am in Anchorage and 4 am in Adak.
	at := time.Date(2026, 10, 4, 13, 0, 0, 0, time.UTC)
	tests := []struct {
		in   string
		at   time.Time
		want bool
	}{
		{"+16465550110", at, true},
		{"+16465550110", at.Add(-time.Hour), true},                // 8:00 am: open
		{"+16465550110", at.Add(-time.Hour - time.Minute), false}, // 7:59 am: too early
		{"+16465550110", at.Add(12 * time.Hour), false},           // 9 pm: too late
		{"+16465550110", at.Add(11*time.Hour + 59*time.Minute), true},
		{"+12135550199", at, false},                    // 6 am in LA
		{"+12135550199", at.Add(2 * time.Hour), true},  // 8 am in LA
		{"+19075550123", at.Add(4 * time.Hour), true},  // 9 am Anchorage, 8 am Adak
		{"+19075550123", at.Add(3 * time.Hour), false}, // 8 am Anchorage but 7 am Adak: wait for both
		{"+1", at, false},                              // unknown zone: no
	}
	for _, tt := range tests {
		if got := InCallingHours(tt.in, tt.at); got != tt.want {
			t.Errorf("InCallingHours(%q, %s) = %v, want %v", tt.in, tt.at.Format(time.RFC3339), got, tt.want)
		}
	}
}
