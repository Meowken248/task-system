package database

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// migrationAdvisoryLockID is a fixed int64 used with pg_advisory_lock to
// prevent concurrent Go API instances from running migrations simultaneously.
const migrationAdvisoryLockID = 7890123456

func (p *Pool) Migrate(ctx context.Context) error {
	if p == nil || p.pool == nil {
		return fmt.Errorf("postgres pool is not configured")
	}

	conn, err := p.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection for migration: %w", err)
	}
	defer conn.Release()

	entries, err := fs.Glob(migrationFiles, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(entries)
	if _, err = conn.Exec(ctx, "CREATE TABLE IF NOT EXISTS public.go_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"); err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}

	// Acquire advisory lock to prevent concurrent migration runs
	if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock($1)", migrationAdvisoryLockID); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", migrationAdvisoryLockID)
	}()

	for _, name := range entries {
		if err = p.applyMigration(ctx, conn, name); err != nil {
			return err
		}
	}
	return nil
}

// djangoVerificationTables are spot-checked when skipping 000_initial_schema.sql
// on a Django database. If these tables don't exist, the skip is invalid.
var djangoVerificationTables = []string{"workspaces", "issues", "sessions", "users", "projects"}

func (p *Pool) applyMigration(ctx context.Context, conn *pgxpool.Conn, name string) error {
	logger := slog.Default()
	sqlBytes, err := migrationFiles.ReadFile(name)
	if err != nil {
		return fmt.Errorf("read migration %s: %w", name, err)
	}
	return pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		var applied bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM public.go_schema_migrations WHERE name = $1)", name).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			logger.Info("migration already applied, skipping", "migration", name)
			return nil
		}

		// Compatibility: skip 000_initial_schema.sql if it's already a Django database
		if name == "migrations/000_initial_schema.sql" {
			var hasDjango bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'django_migrations')").Scan(&hasDjango); err == nil && hasDjango {
				// Verify that the Django database actually has the expected tables
				for _, table := range djangoVerificationTables {
					var exists bool
					if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = $1)", table).Scan(&exists); err != nil {
						return fmt.Errorf("verify Django table %s: %w", table, err)
					}
					if !exists {
						return fmt.Errorf("Django database detected (django_migrations exists) but table %q is missing — database may be corrupted or partially migrated", table)
					}
				}
				logger.Info("skipping initial schema migration for existing Django database", "migration", name)
				if _, err := tx.Exec(ctx, "INSERT INTO public.go_schema_migrations (name) VALUES ($1)", name); err != nil {
					return fmt.Errorf("record migration %s: %w", name, err)
				}
				return nil
			}
		}

		logger.Info("applying migration", "migration", name)
		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO public.go_schema_migrations (name) VALUES ($1)", name); err != nil {
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		return nil
	})
}
