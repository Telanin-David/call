package notify

import (
	"context"
	"fmt"
	"net/http"
)

// Resend sends email through resend.com.
type Resend struct {
	APIKey string
	From   string // "Dialer <noreply@dialer.app>"
	// BaseURL defaults to https://api.resend.com; tests point it elsewhere.
	BaseURL string
	Client  *http.Client
}

func (r Resend) SendEmail(ctx context.Context, m Email) error {
	base := r.BaseURL
	if base == "" {
		base = "https://api.resend.com"
	}
	err := postJSON(ctx, r.Client, base+"/emails",
		map[string]string{"Authorization": "Bearer " + r.APIKey},
		map[string]any{"from": r.From, "to": []string{m.To}, "subject": m.Subject, "text": m.Text})
	if err != nil {
		return fmt.Errorf("resend: %w", err)
	}
	return nil
}
