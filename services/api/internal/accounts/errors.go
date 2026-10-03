package accounts

import (
	"fmt"
	"net/http"
)

// Error is a failure the rep can act on. Message is shown on screen as is.
type Error struct {
	Status  int
	Code    string
	Message string
	// RetryAfter, in seconds, for "send again in 0:42".
	RetryAfter int
}

func (e *Error) Error() string { return "accounts: " + e.Code }

// Is matches errors by code, so a RetryAfter copy still matches its sentinel.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Code == e.Code
}

func invalid(field, message string) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: "invalid_" + field, Message: message}
}

var (
	ErrEmailTaken    = &Error{Status: http.StatusConflict, Code: "email_taken", Message: "That email already has an account. Sign in instead."}
	ErrPhoneTaken    = &Error{Status: http.StatusConflict, Code: "phone_taken", Message: "That phone number already has an account. One account per person."}
	ErrRulesRequired = &Error{Status: http.StatusUnprocessableEntity, Code: "rules_required", Message: "Agree to the rules to carry on."}
	ErrBadLogin      = &Error{Status: http.StatusUnauthorized, Code: "bad_login", Message: "That email, phone or password is wrong."}
	ErrSuspended     = &Error{Status: http.StatusForbidden, Code: "suspended", Message: "This account is paused. Contact support."}
	ErrTooMany       = &Error{Status: http.StatusTooManyRequests, Code: "too_many", Message: "Too many tries. Wait a few minutes and try again."}
	ErrCodeWrong     = &Error{Status: http.StatusUnprocessableEntity, Code: "code_wrong", Message: "That code is wrong. Check it and try again."}
	ErrCodeExpired   = &Error{Status: http.StatusUnprocessableEntity, Code: "code_expired", Message: "That code has expired. Send a new one."}
	ErrCodeLocked    = &Error{Status: http.StatusTooManyRequests, Code: "code_locked", Message: "Too many wrong tries. Send a new code."}
	ErrLinkInvalid   = &Error{Status: http.StatusUnprocessableEntity, Code: "link_invalid", Message: "That link doesn't work. Send a new one from the app."}
	ErrLinkExpired   = &Error{Status: http.StatusUnprocessableEntity, Code: "link_expired", Message: "That link has expired. Send a new one from the app."}
	ErrSendTooSoon   = &Error{Status: http.StatusTooManyRequests, Code: "send_too_soon", Message: "We just sent one. Wait a moment before asking again."}
)

func sendTooSoon(seconds int) *Error {
	e := *ErrSendTooSoon
	e.RetryAfter = seconds
	e.Message = fmt.Sprintf("We just sent one. You can ask again in %d seconds.", seconds)
	return &e
}
