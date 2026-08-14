package database

import (
	"context"
	"testing"
)

func TestRequiredTablesNotEmpty(t *testing.T) {
	if len(requiredTables) == 0 {
		t.Fatal("requiredTables should not be empty")
	}
}

func TestRequiredIssueColumnsNotEmpty(t *testing.T) {
	if len(requiredIssueColumns) == 0 {
		t.Fatal("requiredIssueColumns should not be empty")
	}
}

func TestSchemaAgainstTestDB(t *testing.T) {
	ctx := context.Background()
	pool, err := Open(ctx, "postgresql://plane:plane@127.0.0.1:5432/plane_test_migrate?sslmode=disable")
	if err != nil {
		t.Skipf("cannot connect to test db: %v", err)
	}
	defer pool.Close()

	if err := pool.pool.Ping(ctx); err != nil {
		t.Skipf("test database not available: %v", err)
	}

	// Ensure DB is fully migrated
	if err := pool.Migrate(ctx); err != nil {
		t.Fatalf("failed to migrate fresh db: %v", err)
	}

	// Now check if all required tables actually exist in the DB
	for _, table := range requiredTables {
		var exists bool
		err := pool.pool.QueryRow(ctx, "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)", table).Scan(&exists)
		if err != nil {
			t.Fatalf("failed to query table %s: %v", table, err)
		}
		if !exists {
			t.Errorf("required table %q does not exist in physical schema", table)
		}
	}

	// Check if all required issue columns actually exist in the DB
	for _, col := range requiredIssueColumns {
		var exists bool
		err := pool.pool.QueryRow(ctx, "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'issues' AND column_name = $1)", col).Scan(&exists)
		if err != nil {
			t.Fatalf("failed to query column %s: %v", col, err)
		}
		if !exists {
			t.Errorf("required column %q does not exist in issues table schema", col)
		}
	}

	// Also test ValidateSchema func
	if err := ValidateSchema(ctx, pool.pool); err != nil {
		t.Errorf("ValidateSchema failed: %v", err)
	}
}
