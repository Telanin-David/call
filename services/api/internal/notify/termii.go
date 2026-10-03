package notify

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

// Termii sends SMS and WhatsApp messages through termii.com.
type Termii struct {
	APIKey   string
	SenderID string
	// BaseURL is the account's API host from the Termii dashboard, for
	// example https://v3.api.termii.com.
	BaseURL string
	Client  *http.Client
}

func (t Termii) SendText(ctx context.Context, m Text) error {
	channel := "generic"
	if m.Channel == WhatsApp {
		channel = "whatsapp"
	}
	err := postJSON(ctx, t.Client, strings.TrimRight(t.BaseURL, "/")+"/api/sms/send", nil, map[string]any{
		"api_key": t.APIKey,
		"to":      strings.TrimPrefix(m.To, "+"),
		"from":    t.SenderID,
		"sms":     m.Body,
		"type":    "plain",
		"channel": channel,
	})
	if err != nil {
		return fmt.Errorf("termii: %w", err)
	}
	return nil
}
