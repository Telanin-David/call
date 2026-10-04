package telephony

import "github.com/telanin-david/call/services/api/internal/platform"

// NumbersFromConfig picks Telnyx when its key is set. In development without
// a key, a fake hands out numbers that never ring anyone; elsewhere it
// returns nil and renting numbers is switched off until the key is set.
func NumbersFromConfig(cfg platform.Config) Numbers {
	if cfg.TelnyxAPIKey != "" {
		return telnyxFrom(cfg)
	}
	if cfg.Env == "development" {
		return &FakeNumbers{}
	}
	return nil
}

// CallsFromConfig is NumbersFromConfig for calls. Telnyx needs its public
// key too, or call webhooks can't be checked; without both, development
// gets a fake and elsewhere calling is off.
func CallsFromConfig(cfg platform.Config) Calls {
	if cfg.TelnyxAPIKey != "" && cfg.TelnyxPublicKey != "" {
		return telnyxFrom(cfg)
	}
	if cfg.Env == "development" {
		return NewFakeCalls()
	}
	return nil
}

func telnyxFrom(cfg platform.Config) Telnyx {
	return Telnyx{APIKey: cfg.TelnyxAPIKey, ConnectionID: cfg.TelnyxConnectionID, PublicKey: cfg.TelnyxPublicKey}
}
