package platform

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Addr        string
	DatabaseURL string
	CacheURL    string
	SessionKey  string
	Env         string
	// WebURL is the web app's address, used in links in emails.
	WebURL string
	// WebOrigins may call the api from a browser (CORS). Defaults to WebURL.
	WebOrigins []string

	ResendAPIKey   string
	EmailFrom      string
	TermiiAPIKey   string
	TermiiSenderID string
	TermiiBaseURL  string

	PaystackSecretKey   string
	PaystackCurrency    string
	PaystackMinorPerUSD string
	StripeSecretKey     string
	StripeWebhookSecret string

	TelnyxAPIKey       string
	TelnyxConnectionID string
	TelnyxPublicKey    string
}

// devSessionKey keys code hashes when SESSION_KEY is unset in development.
const devSessionKey = "development-only-session-key"

func MustLoadConfig() Config {
	cfg := Config{
		Addr:           getenv("ADDR", ":8080"),
		DatabaseURL:    getenv("DATABASE_URL", "postgres://dialer:dialer@localhost:5432/dialer?sslmode=disable"),
		CacheURL:       getenv("CACHE_URL", "valkey://localhost:6379"),
		SessionKey:     getenv("SESSION_KEY", ""),
		Env:            getenv("ENV", "development"),
		WebURL:         getenv("WEB_URL", "http://localhost:5173"),
		ResendAPIKey:   getenv("RESEND_API_KEY", ""),
		EmailFrom:      getenv("EMAIL_FROM", "Dialer <noreply@dialer.app>"),
		TermiiAPIKey:   getenv("TERMII_API_KEY", ""),
		TermiiSenderID: getenv("TERMII_SENDER_ID", "Dialer"),
		TermiiBaseURL:  getenv("TERMII_BASE_URL", "https://v3.api.termii.com"),

		PaystackSecretKey:   getenv("PAYSTACK_SECRET_KEY", ""),
		PaystackCurrency:    getenv("PAYSTACK_CURRENCY", "USD"),
		PaystackMinorPerUSD: getenv("PAYSTACK_MINOR_PER_USD", "100"),
		StripeSecretKey:     getenv("STRIPE_SECRET_KEY", ""),
		StripeWebhookSecret: getenv("STRIPE_WEBHOOK_SECRET", ""),

		TelnyxAPIKey:       getenv("TELNYX_API_KEY", ""),
		TelnyxConnectionID: getenv("TELNYX_CONNECTION_ID", ""),
		TelnyxPublicKey:    getenv("TELNYX_PUBLIC_KEY", ""),
	}
	cfg.WebOrigins = strings.Split(getenv("WEB_ORIGINS", cfg.WebURL), ",")
	if cfg.SessionKey == "" && cfg.Env == "production" {
		panic(fmt.Sprintf("SESSION_KEY must be set in %s", cfg.Env))
	}
	if cfg.SessionKey == "" {
		cfg.SessionKey = devSessionKey
	}
	return cfg
}

// Production is true on the live servers, where real providers are required.
func (c Config) Production() bool { return c.Env == "production" }

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}
