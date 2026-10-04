package kyc

import "github.com/telanin-david/call/services/api/internal/platform"

// FromConfig picks Smile ID when its keys are set (the sandbox unless
// SMILEID_SANDBOX=false). In development without keys a fake decides checks
// from the dev routes; elsewhere it returns nil and the ID check is off.
func FromConfig(cfg platform.Config) Provider {
	if cfg.SmileIDPartnerID != "" && cfg.SmileIDAPIKey != "" {
		base := SmileIDSandbox
		if !cfg.SmileIDSandbox {
			base = SmileIDProduction
		}
		return SmileID{BaseURL: base, PartnerID: cfg.SmileIDPartnerID, APIKey: cfg.SmileIDAPIKey, CallbackURL: cfg.SmileIDCallbackURL}
	}
	if cfg.Env == "development" {
		return NewFake()
	}
	return nil
}
