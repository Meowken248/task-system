package database

import (
	"io/fs"
	"testing"
)

func TestBlockchainMigrationIsEmbedded(t *testing.T) {
	entries, err := fs.Glob(migrationFiles, "migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 || entries[0] != "migrations/001_blockchain_events.sql" {
		t.Fatalf("unexpected migrations: %#v", entries)
	}
}
