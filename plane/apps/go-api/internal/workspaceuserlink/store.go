package workspaceuserlink

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) resolve(ctx context.Context, sessionKey, slug string) (string, string, error) {
	if s.Pool == nil {
		return "", "", errors.New("quick link database unavailable")
	}
	if sessionKey == "" {
		return "", "", ErrUnauthorized
	}
	var userID, workspaceID string
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text 
		FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.member_id::text = s.user_id
			AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`, sessionKey, slug).Scan(&userID, &workspaceID)
	if err == nil {
		return userID, workspaceID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", "", fmt.Errorf("resolve workspace session: %w", err)
	}
	var valid bool
	if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key = $1 AND expire_date > NOW())`, sessionKey).Scan(&valid); err != nil {
		return "", "", fmt.Errorf("check workspace session: %w", err)
	}
	if !valid {
		return "", "", ErrUnauthorized
	}
	return "", "", ErrForbidden
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string) ([]WorkspaceUserLink, error) {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id::text, workspace_id::text, owner_id::text, title, url, metadata, created_at, updated_at
		FROM workspace_user_links WHERE workspace_id = $1 AND owner_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC`, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("query quick links: %w", err)
	}
	defer rows.Close()

	var result []WorkspaceUserLink
	for rows.Next() {
		var l WorkspaceUserLink
		if err := rows.Scan(&l.ID, &l.Workspace, &l.Owner, &l.Title, &l.URL, &l.Metadata, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan quick link: %w", err)
		}
		result = append(result, l)
	}
	// Return empty array instead of nil for JSON serialization
	if result == nil {
		result = []WorkspaceUserLink{}
	}
	return result, nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, linkID string) (WorkspaceUserLink, error) {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return WorkspaceUserLink{}, err
	}
	var l WorkspaceUserLink
	err = s.Pool.QueryRow(ctx, `SELECT id::text, workspace_id::text, owner_id::text, title, url, metadata, created_at, updated_at
		FROM workspace_user_links WHERE id = $1 AND workspace_id = $2 AND owner_id = $3 AND deleted_at IS NULL`, linkID, workspaceID, userID).
		Scan(&l.ID, &l.Workspace, &l.Owner, &l.Title, &l.URL, &l.Metadata, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceUserLink{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceUserLink{}, fmt.Errorf("get quick link: %w", err)
	}
	return l, nil
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug string, payload WritePayload) (WorkspaceUserLink, error) {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return WorkspaceUserLink{}, err
	}
	metadata := map[string]any{}
	if payload.Metadata != nil {
		metadata = *payload.Metadata
	}
	var l WorkspaceUserLink
	err = s.Pool.QueryRow(ctx, `INSERT INTO workspace_user_links (workspace_id, owner_id, title, url, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
		RETURNING id::text, workspace_id::text, owner_id::text, title, url, metadata, created_at, updated_at`,
		workspaceID, userID, payload.Title, *payload.URL, metadata).
		Scan(&l.ID, &l.Workspace, &l.Owner, &l.Title, &l.URL, &l.Metadata, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return WorkspaceUserLink{}, fmt.Errorf("create quick link: %w", err)
	}
	return l, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, linkID string, payload WritePayload) (WorkspaceUserLink, error) {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return WorkspaceUserLink{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return WorkspaceUserLink{}, err
	}
	defer tx.Rollback(ctx)

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_user_links WHERE id = $1 AND workspace_id = $2 AND owner_id = $3 AND deleted_at IS NULL FOR UPDATE)`, linkID, workspaceID, userID).Scan(&exists); err != nil {
		return WorkspaceUserLink{}, err
	}
	if !exists {
		return WorkspaceUserLink{}, ErrNotFound
	}

	if payload.Title != nil {
		if _, err := tx.Exec(ctx, `UPDATE workspace_user_links SET title = $1, updated_at = NOW() WHERE id = $2`, *payload.Title, linkID); err != nil {
			return WorkspaceUserLink{}, fmt.Errorf("update title: %w", err)
		}
	}
	if payload.URL != nil {
		if _, err := tx.Exec(ctx, `UPDATE workspace_user_links SET url = $1, updated_at = NOW() WHERE id = $2`, *payload.URL, linkID); err != nil {
			return WorkspaceUserLink{}, fmt.Errorf("update url: %w", err)
		}
	}
	if payload.Metadata != nil {
		if _, err := tx.Exec(ctx, `UPDATE workspace_user_links SET metadata = $1, updated_at = NOW() WHERE id = $2`, *payload.Metadata, linkID); err != nil {
			return WorkspaceUserLink{}, fmt.Errorf("update metadata: %w", err)
		}
	}

	var l WorkspaceUserLink
	if err := tx.QueryRow(ctx, `SELECT id::text, workspace_id::text, owner_id::text, title, url, metadata, created_at, updated_at
		FROM workspace_user_links WHERE id = $1`, linkID).
		Scan(&l.ID, &l.Workspace, &l.Owner, &l.Title, &l.URL, &l.Metadata, &l.CreatedAt, &l.UpdatedAt); err != nil {
		return WorkspaceUserLink{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceUserLink{}, err
	}
	return l, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, linkID string) error {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	res, err := s.Pool.Exec(ctx, `UPDATE workspace_user_links SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND workspace_id = $2 AND owner_id = $3 AND deleted_at IS NULL`, linkID, workspaceID, userID)
	if err != nil {
		return fmt.Errorf("delete quick link: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
