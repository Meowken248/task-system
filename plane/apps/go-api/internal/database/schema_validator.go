package database

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// requiredTables lists the tables that must exist for the Go API to function.
// These are the core Django-managed tables that Go handlers query directly.
var requiredTables = []string{
	"users",
	"workspaces",
	"projects",
	"issues",
	"sessions",
	"states",
	"labels",
	"cycles",
	"modules",
	"project_members",
}

// requiredIssueColumns lists columns on the issues table that Go handlers depend on.
var requiredIssueColumns = []string{
	"id",
	"name",
	"state_id",
	"project_id",
	"created_at",
	"updated_at",
	"deleted_at",
	"created_by_id",
	"updated_by_id",
	"sort_order",
	"priority",
	"is_draft",
}

// ValidateSchema checks that the database has the required tables and columns
// for Go API handlers to function. This should be called after migrations
// but before starting workers or serving traffic.
//
// It does NOT modify the database — it is a read-only check.
func ValidateSchema(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("schema validation: pool is nil")
	}

	// Check required tables
	var missingTables []string
	for _, table := range requiredTables {
		var exists bool
		err := pool.QueryRow(ctx,
			"SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = $1)",
			table,
		).Scan(&exists)
		if err != nil {
			return fmt.Errorf("schema validation: check table %q: %w", table, err)
		}
		if !exists {
			missingTables = append(missingTables, table)
		}
	}

	if len(missingTables) > 0 {
		return fmt.Errorf("schema validation failed: missing tables: %s. "+
			"Ensure Django migrations have completed before starting Go API",
			strings.Join(missingTables, ", "))
	}

	// Check required columns on issues table
	var missingColumns []string
	for _, col := range requiredIssueColumns {
		var exists bool
		err := pool.QueryRow(ctx,
			"SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'issues' AND column_name = $1)",
			col,
		).Scan(&exists)
		if err != nil {
			return fmt.Errorf("schema validation: check column issues.%s: %w", col, err)
		}
		if !exists {
			missingColumns = append(missingColumns, col)
		}
	}

	if len(missingColumns) > 0 {
		return fmt.Errorf("schema validation failed: missing columns on issues table: %s. "+
			"Ensure Django migrations have completed before starting Go API",
			strings.Join(missingColumns, ", "))
	}

	return nil
}
