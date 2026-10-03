// Package notify sends emails and text messages (SMS, WhatsApp). Handlers
// depend on the Mailer and Texter interfaces, never on a provider: Resend
// sends email, Termii sends SMS and WhatsApp, Fake records messages for
// tests, and Log prints them for local development.
package notify

import (
	"context"
	"errors"
	"log/slog"
)

// Email is one plain-text email.
type Email struct {
	To      string
	Subject string
	Text    string
}

// Channel is how a text message travels.
type Channel string

const (
	SMS      Channel = "sms"
	WhatsApp Channel = "whatsapp"
)

// Text is one SMS or WhatsApp message. To is an E.164 number ("+234...").
type Text struct {
	To      string
	Body    string
	Channel Channel
}

type Mailer interface {
	SendEmail(ctx context.Context, m Email) error
}

type Texter interface {
	SendText(ctx context.Context, m Text) error
}

// ErrProvider wraps a refusal from a provider (bad number, no credit).
var ErrProvider = errors.New("notify: provider refused the message")

// Log prints messages instead of sending them. Development only: the codes
// appear in the api's log so you can sign up without real providers.
type Log struct{ Logger *slog.Logger }

func (l Log) SendEmail(_ context.Context, m Email) error {
	l.Logger.Info("email (not sent: development)", "to", m.To, "subject", m.Subject, "text", m.Text)
	return nil
}

func (l Log) SendText(_ context.Context, m Text) error {
	l.Logger.Info("text (not sent: development)", "to", m.To, "channel", m.Channel, "body", m.Body)
	return nil
}
