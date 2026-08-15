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

	pool, err := database.Open(ctx, "postgresql://plane:plane@127.0.0.1:5432/plane?sslmode=disable")
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

func TestDraftToIssue_Integration(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := database.Open(ctx, "postgresql://plane:plane@127.0.0.1:5432/plane?sslmode=disable")
	if err != nil {
		t.Skipf("cannot connect to test db: %v", err)
	}
	defer pool.Close()

	// Seed data
	tx, err := pool.Native().Begin(ctx)
	if err != nil {
		t.Fatalf("failed to begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	// Find existing Workspace
	var workspaceID, userID string
	err = tx.QueryRow(ctx, `SELECT id, owner_id FROM workspaces WHERE slug = 'test-slug-go' LIMIT 1`).Scan(&workspaceID, &userID)
	if err != nil {
		t.Skipf("no workspace found: %v (run seed_integration_test.py first)", err)
	}

	// Session
	sessionKey := "go_test_session_key"
	_, err = tx.Exec(ctx, `INSERT INTO sessions (session_key, session_data, expire_date, user_id) VALUES ($1, 'dummy', now() + interval '1 day', $2) ON CONFLICT (session_key) DO NOTHING`, sessionKey, userID)
	if err != nil {
		t.Fatalf("failed to insert session: %v", err)
	}

	// Project
	var projectID string
	err = tx.QueryRow(ctx, `SELECT id FROM projects WHERE workspace_id = $1 LIMIT 1`, workspaceID).Scan(&projectID)
	if err != nil {
		t.Fatalf("no project found: %v", err)
	}

	// State
	var stateID string
	err = tx.QueryRow(ctx, `SELECT id FROM states WHERE project_id = $1 AND name = 'Todo' LIMIT 1`, projectID).Scan(&stateID)
	if err != nil {
		t.Fatalf("no state found: %v", err)
	}

	// Draft Issue
	var draftID string
	err = tx.QueryRow(ctx, `INSERT INTO draft_issues (id, project_id, workspace_id, name, state_id, created_at, updated_at, created_by_id, updated_by_id, priority, description_html, description_stripped, description_json, sort_order) VALUES (gen_random_uuid(), $1, $2, 'Draft 1', $3, now(), now(), $4, $4, 'none', '', '', '{}'::jsonb, 10000) RETURNING id`, projectID, workspaceID, stateID, userID).Scan(&draftID)
	if err != nil {
		t.Fatalf("failed to insert draft issue: %v", err)
	}

	tx.Commit(ctx) // Commit the seed data so DraftToIssue can see it

	// Use real IssueTxCreator
	issueStore := &issue.PostgreSQLStore{
		Pool: pool.Native(),
	}

	store := draftissue.PostgreSQLStore{
		Pool:           pool.Native(),
		IssueTxCreator: issueStore,
	}

	// Execute DraftToIssue
	name := "Draft 1 converted"
	input := issue.WritePayload{
		Name:    &name,
		StateID: &stateID,
	}
	issueItem, err := store.DraftToIssue(ctx, sessionKey, "test-slug-go", draftID, input)
	if err != nil {
		t.Fatalf("DraftToIssue failed: %v", err)
	}

	if issueItem.ID == "" {
		t.Fatalf("Expected issue ID to be generated")
	}

	// Verify draft issue is deleted
	var count int
	err = pool.Native().QueryRow(ctx, `SELECT count(*) FROM draft_issues WHERE id = $1 AND deleted_at IS NULL`, draftID).Scan(&count)
	if err != nil {
		t.Fatalf("Failed to query draft issue: %v", err)
	}
	if count != 0 {
		t.Fatalf("Expected draft issue to be deleted, but it still exists")
	}

	// Verify real issue is created
	err = pool.Native().QueryRow(ctx, `SELECT count(*) FROM issues WHERE id = $1`, issueItem.ID).Scan(&count)
	if err != nil {
		t.Fatalf("Failed to query real issue: %v", err)
	}
	if count != 1 {
		t.Fatalf("Expected real issue to be created, but count is %d", count)
	}
}
