package database

import (
	"context"
	"io/fs"
	"sync"
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

	if err := pool.pool.Ping(ctx); err != nil {
		t.Skipf("test database not available: %v", err)
	}

	if err := pool.Migrate(ctx); err != nil {
		t.Fatalf("failed to migrate fresh db: %v", err)
	}

	// Ensure idempotent migration
	if err := pool.Migrate(ctx); err != nil {
		t.Fatalf("failed idempotent migration: %v", err)
	}
}

func TestConcurrentMigrations(t *testing.T) {
	ctx := context.Background()
	pool, err := Open(ctx, "postgresql://plane:plane@127.0.0.1:5432/plane_test_migrate?sslmode=disable")
	if err != nil {
		t.Skipf("cannot connect to test db: %v", err)
	}
	defer pool.Close()

	if err := pool.pool.Ping(ctx); err != nil {
		t.Skipf("test database not available: %v", err)
	}

	// We spawn multiple goroutines simulating concurrent API instance starts
	var wg sync.WaitGroup
	var startBarrier sync.WaitGroup
	startBarrier.Add(1)

	numConcurrent := 5
	errs := make(chan error, numConcurrent)

	for i := 0; i < numConcurrent; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			startBarrier.Wait() // wait until all goroutines are ready
			if err := pool.Migrate(ctx); err != nil {
				errs <- err
			}
		}()
	}

	startBarrier.Done() // release the hounds
	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Errorf("concurrent migration failed: %v", err)
		}
	}
}
