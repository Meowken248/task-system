package config

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	Address         string
	DatabaseURL     string
	LegacyAPIURL    string
	ShutdownTimeout time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Address:         envOrDefault("GO_API_ADDRESS", ":8080"),
		DatabaseURL:     strings.TrimSpace(os.Getenv("DATABASE_URL")),
		LegacyAPIURL:    strings.TrimRight(strings.TrimSpace(os.Getenv("LEGACY_API_URL")), "/"),
		ShutdownTimeout: 10 * time.Second,
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	return cfg, nil
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
