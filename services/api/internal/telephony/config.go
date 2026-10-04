package telephony

import "github.com/telanin-david/call/services/api/internal/platform"

// NumbersFromConfig picks Telnyx when its key is set. In development without
// a key, a fake hands out numbers that never ring anyone; elsewhere it
// returns nil and renting numbers is switched off until the key is set.
func NumbersFromConfig(cfg platform.Config) Numbers {
	if cfg.TelnyxAPIKey != "" {
		return Telnyx{APIKey: cfg.TelnyxAPIKey, ConnectionID: cfg.TelnyxConnectionID}
	}
	if cfg.Env == "development" {
		return &FakeNumbers{}
	}
	return nil
}
