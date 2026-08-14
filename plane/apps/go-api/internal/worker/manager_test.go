package worker

import (
	"log/slog"
	"os"
	"testing"
)

func TestManagerDisabledDoesNotStart(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	m := NewManager(logger, false, nil)
	if m.Enabled {
		t.Fatal("expected Enabled=false")
	}
	// Start should return immediately without panic
	m.Start()
	// Stop should be safe to call even when disabled
	m.Stop()
}

func TestManagerEnabledLifecycle(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	m := NewManager(logger, true, nil)
	if !m.Enabled {
		t.Fatal("expected Enabled=true")
	}
	m.Start()
	m.Stop()
}

func TestNewManagerSetsFields(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	m := NewManager(logger, false, nil)
	if m.Logger == nil {
		t.Fatal("Logger should not be nil")
	}
	if m.stop == nil {
		t.Fatal("stop channel should be initialized")
	}
}
