package phone

import (
	_ "embed"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // zone rules built in, so every server agrees
)

// timezones.txt is libphonenumber's resources/timezones/map_data.txt
// (Apache License 2.0, see its header): a number prefix, then the time
// zones numbers starting with it can be in, joined by "&".
//
//go:embed timezones.txt
var timezoneData string

var (
	zonesOnce sync.Once
	zones     map[string][]string
	longest   int
)

func loadZones() {
	zones = map[string][]string{}
	for _, line := range strings.Split(timezoneData, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		prefix, names, ok := strings.Cut(line, "|")
		if !ok {
			continue
		}
		var list []string
		for _, z := range strings.Split(names, "&") {
			if _, err := time.LoadLocation(z); err == nil {
				list = append(list, z)
			}
		}
		if len(list) > 0 {
			zones[prefix] = list
			longest = max(longest, len(prefix))
		}
	}
}

// TimeZones lists the time zones an E.164 number can ring in, best match
// first: most numbers have one; a few area codes span two (Alaska's 907
// covers Anchorage and Adak). It returns nil when nothing is known.
func TimeZones(e164 string) []string {
	zonesOnce.Do(loadZones)
	digits := strings.TrimPrefix(e164, "+")
	for n := min(len(digits), longest); n > 0; n-- {
		if z, ok := zones[digits[:n]]; ok {
			// The bare country code lists every zone in the country; that
			// says nothing about this number.
			if n == 1 && len(z) > 1 {
				return nil
			}
			return z
		}
	}
	return nil
}

// CallingHours are when leads may be called, in their own time: 8 am to
// 9 pm (plan section 12, item 3).
const (
	FirstHour = 8
	LastHour  = 21
)

// InCallingHours reports whether it is between 8 am and 9 pm for the lead
// at t in every zone the number might be in. Unknown zones count as no.
func InCallingHours(e164 string, t time.Time) bool {
	zs := TimeZones(e164)
	if len(zs) == 0 {
		return false
	}
	for _, z := range zs {
		loc, err := time.LoadLocation(z)
		if err != nil {
			return false
		}
		h := t.In(loc).Hour()
		if h < FirstHour || h >= LastHour {
			return false
		}
	}
	return true
}
