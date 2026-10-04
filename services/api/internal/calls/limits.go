package calls

import (
	"fmt"
	"net/http"
	"time"
)

const (
	// MaxTries is how often a rep may call one number (open decision 3:
	// the screens use 3).
	MaxTries = 3
	// AbroadPerDay is what a rep without a checked ID may spend each day on
	// calls outside the US and Canada (open decision 5: the screens use $3).
	AbroadPerDay int64 = 3_000_000
	// WarnBefore is how long before the money runs out a call is warned,
	// and then ended.
	WarnBefore = 30 * time.Second
	// MaxCallLength ends a call that somehow never reports its end.
	MaxCallLength = 2 * time.Hour
)

// DailyLimit is how many calls a rep may start in a day, and false when
// there is no limit. Free is 30 a day; until the ID check, it drops to 25 in
// the second month and 10 from the third (the Rules page; open decision 2
// keeps this to Free). Starter is 120, or 500 after the ID check. Pro has
// no limit.
func DailyLimit(plan string, verified bool, signedUp, now time.Time) (int, bool) {
	switch plan {
	case "pro":
		return 0, false
	case "starter":
		if verified {
			return 500, true
		}
		return 120, true
	}
	if verified {
		return 30, true
	}
	switch months := monthsSince(signedUp, now); {
	case months < 1:
		return 30, true
	case months < 2:
		return 25, true
	}
	return 10, true
}

// monthsSince counts whole months from a to b: 4 Oct to 3 Nov is 0, to
// 4 Nov is 1.
func monthsSince(a, b time.Time) int {
	m := (b.Year()-a.Year())*12 + int(b.Month()) - int(a.Month())
	if b.Day() < a.Day() {
		m--
	}
	return max(m, 0)
}

// Blocked is why a call can't start, in the words the rep sees (board 34).
// Action is the one next step the screen offers.
type Blocked struct {
	Status  int
	Code    string
	Title   string
	Message string
	Action  string // "top_up", "skip", "verify_id", "upgrade", "get_number" or ""
}

func (b *Blocked) Error() string { return "calls: blocked: " + b.Code }

// Is matches by code, so a copy with the lead's name still matches.
func (b *Blocked) Is(target error) bool {
	t, ok := target.(*Blocked)
	return ok && t.Code == b.Code
}

var (
	ErrLeadNotFound = &Blocked{http.StatusNotFound, "lead_not_found", "That lead isn't on your lists", "Pick a lead from your lists.", ""}
	ErrCallNotFound = &Blocked{http.StatusNotFound, "call_not_found", "That call isn't one of yours", "", ""}
	ErrOnACall      = &Blocked{http.StatusConflict, "on_a_call", "You're already on a call", "Finish that call first.", ""}
	ErrSuspended    = &Blocked{http.StatusForbidden, "suspended", "Your account is paused", "Contact support to find out why.", ""}
	ErrNoNumber     = &Blocked{http.StatusForbidden, "no_number", "Get a number first", "Leads see your number when you call, and can call you back on it.", "get_number"}
	ErrUnavailable  = &Blocked{http.StatusServiceUnavailable, "calling_unavailable", "Calling isn't working right now", "Try again in a few minutes. You were not charged.", ""}
	ErrCallLive     = &Blocked{http.StatusConflict, "call_live", "This call hasn't ended yet", "Save how it went once it ends.", ""}
	ErrBadOutcome   = &Blocked{http.StatusUnprocessableEntity, "invalid_outcome", "Pick how the call went", "", ""}
	ErrBadFollowup  = &Blocked{http.StatusUnprocessableEntity, "invalid_followup", "Pick a follow-up time in the next year", "", ""}
	ErrNoteTooLong  = &Blocked{http.StatusUnprocessableEntity, "note_too_long", "Keep the note under 2,000 characters", "", ""}

	ErrFollowupNotFound = &Blocked{http.StatusNotFound, "followup_not_found", "That follow-up isn't one of yours", "", ""}
	ErrBadCursor        = &Blocked{http.StatusBadRequest, "bad_cursor", "That page link is broken", "Reload History.", ""}

	errDailyLimit = &Blocked{Code: "daily_limit"}
	errLowBalance = &Blocked{Code: "low_balance"}
	errTries      = &Blocked{Code: "three_tries"}
	errDNC        = &Blocked{Code: "do_not_call"}
	errPremium    = &Blocked{Code: "premium"}
	errHours      = &Blocked{Code: "calling_hours"}
	errNoRate     = &Blocked{Code: "no_rate"}
	errAbroadCap  = &Blocked{Code: "abroad_cap"}
)

func dailyLimit(limit int, plan string, verified bool) *Blocked {
	next := "Calling opens again at midnight, your time."
	action := ""
	switch {
	case plan == "free":
		next += " Starter gives you 120 a day."
		action = "upgrade"
	case plan == "starter" && !verified:
		next += " Verify your ID and Starter gives you 500 a day."
		action = "verify_id"
	}
	return &Blocked{http.StatusForbidden, errDailyLimit.Code, fmt.Sprintf("You've used your %d dials for today", limit), next, action}
}

func lowBalance(balance int64) *Blocked {
	return &Blocked{http.StatusPaymentRequired, errLowBalance.Code, "Top up to keep calling",
		fmt.Sprintf("Your balance is %s. That is not enough to start a call.", dollars(balance)), "top_up"}
}

func threeTries(name string) *Blocked {
	return &Blocked{http.StatusForbidden, errTries.Code, "You can't call " + name + " again",
		fmt.Sprintf("You've called this number %d times. We stop here so leads aren't pestered and your number stays clean.", MaxTries), "skip"}
}

func doNotCall(name string) *Blocked {
	return &Blocked{http.StatusForbidden, errDNC.Code, "Skipped " + name,
		"This number is on the do-not-call list. We never call it and you were not charged.", "skip"}
}

func premium(name string) *Blocked {
	return &Blocked{http.StatusForbidden, errPremium.Code, "Skipped " + name,
		"This is a premium-rate number. We never call those, and you were not charged.", "skip"}
}

func outsideHours(name, herTime string) *Blocked {
	title := "It's too early or late to call " + name
	if herTime != "" {
		title = "It's " + herTime + " for " + name
	}
	return &Blocked{http.StatusForbidden, errHours.Code, title, "Call between 8 am and 9 pm their time. Try the next lead.", "skip"}
}

func noRate(name string) *Blocked {
	return &Blocked{http.StatusForbidden, errNoRate.Code, "We can't call " + name + "'s country yet",
		"Calls to this country aren't open. You were not charged.", "skip"}
}

func abroadCap() *Blocked {
	return &Blocked{http.StatusForbidden, errAbroadCap.Code, fmt.Sprintf("You've reached %s today outside the US and Canada", dollars(AbroadPerDay)),
		"New accounts have this daily cap until the ID check. Calls to the US and Canada still work.", "verify_id"}
}

func dollars(micro int64) string {
	cents := (micro + 5_000) / 10_000
	if micro < 0 {
		cents = (micro - 5_000) / 10_000
	}
	sign := ""
	if cents < 0 {
		sign, cents = "-", -cents
	}
	return fmt.Sprintf("%s$%d.%02d", sign, cents/100, cents%100)
}

// ErrListNotFound is a call screen opened on a list that isn't the rep's.
var ErrListNotFound = &Blocked{http.StatusNotFound, "list_not_found", "That list isn't one of yours", "Pick a list on the Leads page.", ""}
