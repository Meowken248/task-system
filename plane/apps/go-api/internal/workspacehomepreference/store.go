package workspacehomepreference

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
		return "", "", errors.New("home preference database unavailable")
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

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string) ([]WorkspaceHomePreference, error) {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id::text, workspace_id::text, user_id::text, key, is_enabled, config, sort_order, created_at, updated_at
		FROM workspace_home_preferences WHERE workspace_id = $1 AND user_id = $2 AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`, workspaceID, userID)
	if err != nil {
		return nil, fmt.Errorf("query home preferences: %w", err)
	}
	defer rows.Close()

	var result []WorkspaceHomePreference
	for rows.Next() {
		var p WorkspaceHomePreference
		if err := rows.Scan(&p.ID, &p.Workspace, &p.User, &p.Key, &p.IsEnabled, &p.Config, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan home preference: %w", err)
		}
		result = append(result, p)
	}
	return result, nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, key string) (WorkspaceHomePreference, error) {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return WorkspaceHomePreference{}, err
	}
	var p WorkspaceHomePreference
	err = s.Pool.QueryRow(ctx, `SELECT id::text, workspace_id::text, user_id::text, key, is_enabled, config, sort_order, created_at, updated_at
		FROM workspace_home_preferences WHERE key = $1 AND workspace_id = $2 AND user_id = $3 AND deleted_at IS NULL`, key, workspaceID, userID).
		Scan(&p.ID, &p.Workspace, &p.User, &p.Key, &p.IsEnabled, &p.Config, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceHomePreference{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceHomePreference{}, fmt.Errorf("get home preference: %w", err)
	}
	return p, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, key string, payload WritePayload) (WorkspaceHomePreference, error) {
	userID, workspaceID, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return WorkspaceHomePreference{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return WorkspaceHomePreference{}, err
	}
	defer tx.Rollback(ctx)

	var p WorkspaceHomePreference
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_home_preferences WHERE key = $1 AND workspace_id = $2 AND user_id = $3 AND deleted_at IS NULL FOR UPDATE)`, key, workspaceID, userID).Scan(&exists); err != nil {
		return WorkspaceHomePreference{}, err
	}
	
	if !exists {
		// Create if it doesn't exist
		isEnabled := true
		if payload.IsEnabled != nil {
			isEnabled = *payload.IsEnabled
		}
		config := map[string]any{}
		if payload.Config != nil {
			config = *payload.Config
		}
		sortOrder := float64(65535)
		if payload.SortOrder != nil {
			sortOrder = *payload.SortOrder
		}
		err = tx.QueryRow(ctx, `INSERT INTO workspace_home_preferences (workspace_id, user_id, key, is_enabled, config, sort_order, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
			RETURNING id::text, workspace_id::text, user_id::text, key, is_enabled, config, sort_order, created_at, updated_at`,
			workspaceID, userID, key, isEnabled, config, sortOrder).
			Scan(&p.ID, &p.Workspace, &p.User, &p.Key, &p.IsEnabled, &p.Config, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return WorkspaceHomePreference{}, fmt.Errorf("create home preference: %w", err)
		}
	} else {
		// Update existing
		if payload.IsEnabled != nil {
			if _, err := tx.Exec(ctx, `UPDATE workspace_home_preferences SET is_enabled = $1, updated_at = NOW() WHERE key = $2 AND workspace_id = $3 AND user_id = $4`, *payload.IsEnabled, key, workspaceID, userID); err != nil {
				return WorkspaceHomePreference{}, fmt.Errorf("update is_enabled: %w", err)
			}
		}
		if payload.Config != nil {
			if _, err := tx.Exec(ctx, `UPDATE workspace_home_preferences SET config = $1, updated_at = NOW() WHERE key = $2 AND workspace_id = $3 AND user_id = $4`, *payload.Config, key, workspaceID, userID); err != nil {
				return WorkspaceHomePreference{}, fmt.Errorf("update config: %w", err)
			}
		}
		if payload.SortOrder != nil {
			if _, err := tx.Exec(ctx, `UPDATE workspace_home_preferences SET sort_order = $1, updated_at = NOW() WHERE key = $2 AND workspace_id = $3 AND user_id = $4`, *payload.SortOrder, key, workspaceID, userID); err != nil {
				return WorkspaceHomePreference{}, fmt.Errorf("update sort_order: %w", err)
			}
		}
		if err := tx.QueryRow(ctx, `SELECT id::text, workspace_id::text, user_id::text, key, is_enabled, config, sort_order, created_at, updated_at
			FROM workspace_home_preferences WHERE key = $1 AND workspace_id = $2 AND user_id = $3`, key, workspaceID, userID).
			Scan(&p.ID, &p.Workspace, &p.User, &p.Key, &p.IsEnabled, &p.Config, &p.SortOrder, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return WorkspaceHomePreference{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return WorkspaceHomePreference{}, err
	}
	return p, nil
}
