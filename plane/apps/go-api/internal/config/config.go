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
	AdminSessionCookie        string
	SessionSecret             string
	SessionAge                time.Duration
	CookieDomain              string
	EnableSignUp              bool
	EnableEmailPassword       bool
	EmailHost                 string
	EmailHostUser             string
	EmailHostPassword         string
	EmailPort                 string
	EmailUseTLS               bool
	EmailUseSSL               bool
	EmailFrom                 string
	PasswordResetTimeout      time.Duration
	EnableMagicLogin          bool
	BlockchainRPCURL          string
	BlockchainContractAddress string
	BlockchainChainID         string
	BlockchainRPCTimeout      time.Duration
	BlockchainReceiptWait     time.Duration
	LegacyTrackingDir         string
	WebhookAllowedIPs         []string
	WebhookAllowedHosts       []string
	WebhookDisallowedDomains  []string
	UnsplashAccessKey         string
	SkipEnvVar                bool
	ShutdownTimeout           time.Duration
	// S3/MinIO Configuration
	AWSAccessKeyID         string
	AWSSecretAccessKey     string
	AWSS3BucketName        string
	AWSRegion              string
	AWSS3EndpointURL       string
	AWSS3PublicEndpointURL string
	UseMinio               bool
	MinioEndpointSSL       bool
	SignedURLExpiration    time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Address:                   envOrDefault("GO_API_ADDRESS", ":8080"),
		DatabaseURL:               strings.TrimSpace(os.Getenv("DATABASE_URL")),
		LegacyAPIURL:              strings.TrimRight(strings.TrimSpace(os.Getenv("LEGACY_API_URL")), "/"),
		AppBaseURL:                strings.TrimRight(envOrDefault("APP_BASE_URL", "http://localhost:3000"), "/"),
		SessionCookie:             envOrDefault("SESSION_COOKIE_NAME", "session-id"),
		AdminSessionCookie:        envOrDefault("ADMIN_SESSION_COOKIE_NAME", "admin-session-id"),
		SessionSecret:             strings.TrimSpace(os.Getenv("SECRET_KEY")),
		SessionAge:                durationSeconds("SESSION_COOKIE_AGE", 7*24*time.Hour, 365*24*time.Hour),
		CookieDomain:              strings.TrimSpace(os.Getenv("COOKIE_DOMAIN")),
		EnableSignUp:              envBool("ENABLE_SIGNUP", true),
		EnableEmailPassword:       envBool("ENABLE_EMAIL_PASSWORD", true),
		EmailHost:                 strings.TrimSpace(os.Getenv("EMAIL_HOST")),
		EmailHostUser:             strings.TrimSpace(os.Getenv("EMAIL_HOST_USER")),
		EmailHostPassword:         strings.TrimSpace(os.Getenv("EMAIL_HOST_PASSWORD")),
		EmailPort:                 envOrDefault("EMAIL_PORT", "587"),
		EmailUseTLS:               envBool("EMAIL_USE_TLS", true),
		EmailUseSSL:               envBool("EMAIL_USE_SSL", false),
		EmailFrom:                 envOrDefault("EMAIL_FROM", "Team Plane <team@mailer.plane.so>"),
		PasswordResetTimeout:      durationSeconds("PASSWORD_RESET_TIMEOUT", 72*time.Hour, 30*24*time.Hour),
		EnableMagicLogin:          envBool("ENABLE_MAGIC_LINK_LOGIN", true),
		BlockchainRPCURL:          firstEnv("BLOCKCHAIN_RPC_URL", "RPC_URL", "VITE_RPC_URL"),
		BlockchainContractAddress: strings.ToLower(firstEnv("BLOCKCHAIN_CONTRACT_ADDRESS", "VITE_CONTRACT_ADDRESS")),
		BlockchainChainID:         firstEnv("BLOCKCHAIN_CHAIN_ID", "CHAIN_ID", "VITE_CHAIN_ID"),
		BlockchainRPCTimeout:      durationSeconds("BLOCKCHAIN_RPC_TIMEOUT_SECONDS", 8*time.Second, 30*time.Second),
		BlockchainReceiptWait:     durationSeconds("BLOCKCHAIN_RECEIPT_WAIT_SECONDS", 15*time.Second, 60*time.Second),
		LegacyTrackingDir:         strings.TrimSpace(os.Getenv("LEGACY_TRACKING_DIR")),
		WebhookAllowedIPs:         csvEnv("WEBHOOK_ALLOWED_IPS"),
		WebhookAllowedHosts:       csvEnv("WEBHOOK_ALLOWED_HOSTS"),
		WebhookDisallowedDomains:  csvEnv("WEBHOOK_DISALLOWED_DOMAINS"),
		UnsplashAccessKey:         strings.TrimSpace(os.Getenv("UNSPLASH_ACCESS_KEY")),
		SkipEnvVar:                envBool("SKIP_ENV_VAR", false),
		ShutdownTimeout:           10 * time.Second,
		AWSAccessKeyID:            strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID")),
		AWSSecretAccessKey:        strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY")),
		AWSS3BucketName:           strings.TrimSpace(os.Getenv("AWS_S3_BUCKET_NAME")),
		AWSRegion:                 strings.TrimSpace(os.Getenv("AWS_REGION")),
		AWSS3EndpointURL:          firstEnv("AWS_S3_ENDPOINT_URL", "MINIO_ENDPOINT_URL"),
		AWSS3PublicEndpointURL:    strings.TrimSpace(os.Getenv("AWS_S3_PUBLIC_ENDPOINT_URL")),
		UseMinio:                  envBool("USE_MINIO", false),
		MinioEndpointSSL:          envBool("MINIO_ENDPOINT_SSL", false),
		SignedURLExpiration:       durationSeconds("SIGNED_URL_EXPIRATION", 3600*time.Second, 24*time.Hour),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	return cfg, nil
}

func csvEnv(key string) []string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if part = strings.TrimSpace(part); part != "" {
			result = append(result, strings.ToLower(part))
		}
	}
	return result
}

func envBool(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	return value == "1" || value == "true" || value == "yes" || value == "on"
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
