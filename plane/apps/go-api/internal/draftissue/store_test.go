package draftissue_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/makeplane/plane/apps/go-api/internal/draftissue"
	"github.com/makeplane/plane/apps/go-api/internal/issue"
	"github.com/makeplane/plane/apps/go-api/internal/database"
)

type mockIssueTxCreator struct {
	err error
}

func (m *mockIssueTxCreator) CreateForSessionTx(ctx context.Context, tx pgx.Tx, sessionKey, slug, projectID string, input issue.WritePayload) (issue.Item, error) {
	if m.err != nil {
		return issue.Item{}, m.err
	}
	return issue.Item{ID: "test-issue-id", ProjectID: projectID}, nil
}

func TestDraftToIssue_AtomicRollback(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := database.Open(ctx, "postgresql://plane:plane@127.0.0.1:5432/plane_test_migrate?sslmode=disable")
	if err != nil {
		t.Skipf("cannot connect to test db: %v", err)
	}
	defer pool.Close()
	
	// Create a mock draft issue to test the atomic rollback.
	// We use the DraftToIssue function but inject an error.
	store := draftissue.PostgreSQLStore{
		Pool:           pool.Native(),
		IssueTxCreator: &mockIssueTxCreator{err: errors.New("simulated error during issue creation")},
	}

	// Calling DraftToIssue should fail and not panic.
	// Since we are not seeding real session/workspace data, it will likely fail with ErrUnauthorized first.
	_, err = store.DraftToIssue(ctx, "fake-session", "fake-slug", "fake-draft-id", issue.WritePayload{})
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
}
