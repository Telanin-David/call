package notify

import (
	"errors"
	"log/slog"

	"github.com/telanin-david/call/services/api/internal/platform"
)

// FromConfig picks real senders when their keys are set. Without keys,
// development logs messages instead of sending them; production refuses.
func FromConfig(cfg platform.Config, logger *slog.Logger) (Mailer, Texter, error) {
	var mail Mailer = Log{Logger: logger}
	var text Texter = Log{Logger: logger}
	if cfg.ResendAPIKey != "" {
		mail = Resend{APIKey: cfg.ResendAPIKey, From: cfg.EmailFrom}
	} else if cfg.Production() {
		return nil, nil, errors.New("RESEND_API_KEY must be set in production")
	}
	if cfg.TermiiAPIKey != "" {
		text = Termii{APIKey: cfg.TermiiAPIKey, SenderID: cfg.TermiiSenderID, BaseURL: cfg.TermiiBaseURL}
	} else if cfg.Production() {
		return nil, nil, errors.New("TERMII_API_KEY must be set in production")
	}
	return mail, text, nil
}
