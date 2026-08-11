package database

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

func (p *Pool) Migrate(ctx context.Context) error {
	if p == nil || p.pool == nil {
		return fmt.Errorf("postgres pool is not configured")
	}
	entries, err := fs.Glob(migrationFiles, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(entries)
	if _, err = p.pool.Exec(ctx, "CREATE TABLE IF NOT EXISTS public.go_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"); err != nil {
		return fmt.Errorf("create migration table: %w", err)
	}
	for _, name := range entries {
		if err = p.applyMigration(ctx, name); err != nil {
			return err
		}
	}
	return nil
}

func (p *Pool) applyMigration(ctx context.Context, name string) error {
	sqlBytes, err := migrationFiles.ReadFile(name)
	if err != nil {
		return fmt.Errorf("read migration %s: %w", name, err)
	}
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var applied bool
		if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM public.go_schema_migrations WHERE name = $1)", name).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			return nil
		}
		
		// Compatibility: skip 000_initial_schema.sql if it's already a Django database
		if name == "migrations/000_initial_schema.sql" {
			var hasDjango bool
			if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'django_migrations')").Scan(&hasDjango); err == nil && hasDjango {
				if _, err := tx.Exec(ctx, "INSERT INTO public.go_schema_migrations (name) VALUES ($1)", name); err != nil {
					return fmt.Errorf("record migration %s: %w", name, err)
				}
				return nil
			}
		}

		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO public.go_schema_migrations (name) VALUES ($1)", name); err != nil {
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		return nil
	})
}
