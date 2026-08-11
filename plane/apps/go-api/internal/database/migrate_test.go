package database

import (
	"context"
	"io/fs"
	"testing"
)

func TestBlockchainMigrationIsEmbedded(t *testing.T) {
	entries, err := fs.Glob(migrationFiles, "migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 2 {
		t.Fatalf("unexpected migrations: %#v", entries)
	}
	if entries[0] != "migrations/000_initial_schema.sql" || entries[1] != "migrations/001_blockchain_events.sql" {
		t.Fatalf("unexpected migrations order: %#v", entries)
	}
}

func TestBootstrapFreshDatabase(t *testing.T) {
	ctx := context.Background()
	pool, err := Open(ctx, "postgresql://plane:plane@127.0.0.1:5432/plane_test_migrate?sslmode=disable")
	if err != nil {
		t.Skipf("cannot connect to test db: %v", err)
	}
	defer pool.Close()

	if err := pool.Migrate(ctx); err != nil {
		t.Fatalf("failed to migrate fresh db: %v", err)
	}

	// Ensure idempotent migration
	if err := pool.Migrate(ctx); err != nil {
		t.Fatalf("failed idempotent migration: %v", err)
	}
}
