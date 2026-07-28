package config

import (
	"errors"
	"os"
	"strings"
	"time"
)

type Config struct {
	Address                   string
	DatabaseURL               string
	LegacyAPIURL              string
	AppBaseURL                string
	SessionCookie             string
	CookieDomain              string
	BlockchainRPCURL          string
	BlockchainContractAddress string
	BlockchainChainID         string
	BlockchainRPCTimeout      time.Duration
	BlockchainReceiptWait     time.Duration
	ShutdownTimeout           time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Address:                   envOrDefault("GO_API_ADDRESS", ":8080"),
		DatabaseURL:               strings.TrimSpace(os.Getenv("DATABASE_URL")),
		LegacyAPIURL:              strings.TrimRight(strings.TrimSpace(os.Getenv("LEGACY_API_URL")), "/"),
		AppBaseURL:                strings.TrimRight(envOrDefault("APP_BASE_URL", "http://localhost:3000"), "/"),
		SessionCookie:             envOrDefault("SESSION_COOKIE_NAME", "session-id"),
		CookieDomain:              strings.TrimSpace(os.Getenv("COOKIE_DOMAIN")),
		BlockchainRPCURL:          firstEnv("BLOCKCHAIN_RPC_URL", "RPC_URL", "VITE_RPC_URL"),
		BlockchainContractAddress: strings.ToLower(firstEnv("BLOCKCHAIN_CONTRACT_ADDRESS", "VITE_CONTRACT_ADDRESS")),
		BlockchainChainID:         firstEnv("BLOCKCHAIN_CHAIN_ID", "CHAIN_ID", "VITE_CHAIN_ID"),
		BlockchainRPCTimeout:      durationSeconds("BLOCKCHAIN_RPC_TIMEOUT_SECONDS", 8*time.Second, 30*time.Second),
		BlockchainReceiptWait:     durationSeconds("BLOCKCHAIN_RECEIPT_WAIT_SECONDS", 15*time.Second, 60*time.Second),
		ShutdownTimeout:           10 * time.Second,
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	return cfg, nil
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func durationSeconds(key string, fallback, maximum time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value + "s")
	if err != nil || parsed < time.Second {
		return fallback
	}
	if parsed > maximum {
		return maximum
	}
	return parsed
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
