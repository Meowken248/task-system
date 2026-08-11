package workspacetheme

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
		return "", "", errors.New("workspace theme database unavailable")
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

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string) ([]WorkspaceTheme, error) {
	_, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id::text, workspace_id::text, name, actor_id::text, colors, created_at, updated_at
		FROM workspace_themes WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("query workspace themes: %w", err)
	}
	defer rows.Close()

	var result []WorkspaceTheme
	for rows.Next() {
		var t WorkspaceTheme
		if err := rows.Scan(&t.ID, &t.Workspace, &t.Name, &t.Actor, &t.Colors, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workspace theme: %w", err)
		}
		result = append(result, t)
	}
	return result, nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, themeID string) (WorkspaceTheme, error) {
	_, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return WorkspaceTheme{}, err
	}
	var t WorkspaceTheme
	err = s.Pool.QueryRow(ctx, `SELECT id::text, workspace_id::text, name, actor_id::text, colors, created_at, updated_at
		FROM workspace_themes WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, themeID, workspaceID).
		Scan(&t.ID, &t.Workspace, &t.Name, &t.Actor, &t.Colors, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceTheme{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceTheme{}, fmt.Errorf("get workspace theme: %w", err)
	}
	return t, nil
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug string, payload WritePayload) (WorkspaceTheme, error) {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return WorkspaceTheme{}, err
	}
	colors := map[string]any{}
	if payload.Colors != nil {
		colors = *payload.Colors
	}
	var t WorkspaceTheme
	err = s.Pool.QueryRow(ctx, `INSERT INTO workspace_themes (workspace_id, name, actor_id, colors, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		RETURNING id::text, workspace_id::text, name, actor_id::text, colors, created_at, updated_at`,
		workspaceID, *payload.Name, userID, colors).
		Scan(&t.ID, &t.Workspace, &t.Name, &t.Actor, &t.Colors, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return WorkspaceTheme{}, fmt.Errorf("create workspace theme: %w", err)
	}
	return t, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, themeID string, payload WritePayload) (WorkspaceTheme, error) {
	_, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return WorkspaceTheme{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return WorkspaceTheme{}, err
	}
	defer tx.Rollback(ctx)

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_themes WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR UPDATE)`, themeID, workspaceID).Scan(&exists); err != nil {
		return WorkspaceTheme{}, err
	}
	if !exists {
		return WorkspaceTheme{}, ErrNotFound
	}

	if payload.Name != nil {
		if _, err := tx.Exec(ctx, `UPDATE workspace_themes SET name = $1, updated_at = NOW() WHERE id = $2`, *payload.Name, themeID); err != nil {
			return WorkspaceTheme{}, fmt.Errorf("update theme name: %w", err)
		}
	}
	if payload.Colors != nil {
		if _, err := tx.Exec(ctx, `UPDATE workspace_themes SET colors = $1, updated_at = NOW() WHERE id = $2`, *payload.Colors, themeID); err != nil {
			return WorkspaceTheme{}, fmt.Errorf("update theme colors: %w", err)
		}
	}

	var t WorkspaceTheme
	if err := tx.QueryRow(ctx, `SELECT id::text, workspace_id::text, name, actor_id::text, colors, created_at, updated_at
		FROM workspace_themes WHERE id = $1`, themeID).
		Scan(&t.ID, &t.Workspace, &t.Name, &t.Actor, &t.Colors, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return WorkspaceTheme{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceTheme{}, err
	}
	return t, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, themeID string) error {
	_, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	res, err := s.Pool.Exec(ctx, `UPDATE workspace_themes SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`, themeID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete workspace theme: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
