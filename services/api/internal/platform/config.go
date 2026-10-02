package platform

import (
	"fmt"
	"os"
)

type Config struct {
	Addr        string
	DatabaseURL string
	CacheURL    string
	SessionKey  string
	Env         string
}

func MustLoadConfig() Config {
	cfg := Config{
		Addr:        getenv("ADDR", ":8080"),
		DatabaseURL: getenv("DATABASE_URL", "postgres://dialer:dialer@localhost:5432/dialer?sslmode=disable"),
		CacheURL:    getenv("CACHE_URL", "valkey://localhost:6379"),
		SessionKey:  getenv("SESSION_KEY", ""),
		Env:         getenv("ENV", "development"),
	}
	if cfg.SessionKey == "" && cfg.Env == "production" {
		panic(fmt.Sprintf("SESSION_KEY must be set in %s", cfg.Env))
	}
	return cfg
}

func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}
