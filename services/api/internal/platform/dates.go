package platform

import "time"

// ToDate drops the time of day, in UTC.
func ToDate(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// AddMonths moves a date by n months, keeping the day of the month
// something started on (anchor) where the month has it: started 31 Jan, it
// renews 28 Feb, then 31 Mar. Plans and numbers renew this way.
func AddMonths(d time.Time, n, anchor int) time.Time {
	first := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, n, 0)
	last := first.AddDate(0, 1, -1).Day()
	if anchor > last {
		anchor = last
	}
	return time.Date(first.Year(), first.Month(), anchor, 0, 0, 0, 0, time.UTC)
}
