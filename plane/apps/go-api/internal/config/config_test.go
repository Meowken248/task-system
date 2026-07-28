package config

import "testing"

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected DATABASE_URL validation error")
	}
}

func TestLoadUsesDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://plane:plane@plane-db:5432/plane")
	t.Setenv("GO_API_ADDRESS", "")
	t.Setenv("LEGACY_API_URL", "http://api:8000/")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Address != ":8080" {
		t.Fatalf("Address = %q, want :8080", cfg.Address)
	}
	if cfg.LegacyAPIURL != "http://api:8000" {
		t.Fatalf("LegacyAPIURL = %q", cfg.LegacyAPIURL)
	}
}

func TestLoadPasswordRecoverySettings(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://plane:plane@plane-db:5432/plane")
	t.Setenv("EMAIL_HOST", "smtp.example.com")
	t.Setenv("EMAIL_HOST_USER", "mailer")
	t.Setenv("EMAIL_HOST_PASSWORD", "secret")
	t.Setenv("EMAIL_PORT", "465")
	t.Setenv("EMAIL_USE_TLS", "0")
	t.Setenv("EMAIL_USE_SSL", "1")
	t.Setenv("EMAIL_FROM", "Plane <plane@example.com>")
	t.Setenv("PASSWORD_RESET_TIMEOUT", "3600")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.EmailHost != "smtp.example.com" || cfg.EmailPort != "465" || cfg.EmailUseTLS || !cfg.EmailUseSSL {
		t.Fatalf("unexpected SMTP config: %+v", cfg)
	}
	if cfg.PasswordResetTimeout.String() != "1h0m0s" {
		t.Fatalf("PasswordResetTimeout=%s", cfg.PasswordResetTimeout)
	}
}
