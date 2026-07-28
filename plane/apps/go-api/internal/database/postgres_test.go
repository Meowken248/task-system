package database

import (
	"context"
	"testing"
)

func TestOpenParsesPostgresURLWithoutConnecting(t *testing.T) {
	pool, err := Open(context.Background(), "postgresql://plane:plane@plane-db:5432/plane")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer pool.Close()
	if pool.Native() == nil {
		t.Fatal("expected native pool")
	}
}

func TestOpenRejectsMissingURL(t *testing.T) {
	if _, err := Open(context.Background(), " "); err == nil {
		t.Fatal("expected validation error")
	}
}
