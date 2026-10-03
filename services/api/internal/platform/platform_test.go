package platform

import (
	"os"
	"testing"
)

func TestMustLoadConfig(t *testing.T) {
	tests := []struct {
		name      string
		env       map[string]string
		wantAddr  string
		wantEnv   string
		wantPanic bool
	}{
		{name: "defaults", wantAddr: ":8080", wantEnv: "development"},
		{name: "env overrides", env: map[string]string{"ADDR": ":9090", "ENV": "staging"}, wantAddr: ":9090", wantEnv: "staging"},
		{name: "production needs a session key", env: map[string]string{"ENV": "production"}, wantPanic: true},
		{name: "production with session key", env: map[string]string{"ENV": "production", "SESSION_KEY": "k"}, wantAddr: ":8080", wantEnv: "production"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, k := range []string{"ADDR", "ENV", "SESSION_KEY"} {
				t.Setenv(k, "") // registers restore of the original value
				os.Unsetenv(k)
			}
			for k, v := range tt.env {
				t.Setenv(k, v)
			}
			defer func() {
				if r := recover(); (r != nil) != tt.wantPanic {
					t.Fatalf("panic = %v, wantPanic %v", r, tt.wantPanic)
				}
			}()
			cfg := MustLoadConfig()
			if cfg.Addr != tt.wantAddr || cfg.Env != tt.wantEnv {
				t.Fatalf("got Addr=%q Env=%q, want Addr=%q Env=%q", cfg.Addr, cfg.Env, tt.wantAddr, tt.wantEnv)
			}
		})
	}
}
