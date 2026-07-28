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
