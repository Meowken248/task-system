package recentvisit

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, entityName string) ([]map[string]any, error) {
	if s.Pool == nil {
		return nil, fmt.Errorf("recent visit database unavailable")
	}

	// 1. Resolve User Access
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.member_id::text = s.user_id AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`, sessionKey, slug).Scan(&userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			var valid bool
			_ = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key = $1 AND expire_date > NOW())`, sessionKey).Scan(&valid)
			if valid {
				return nil, ErrForbidden
			}
			return nil, ErrUnauthorized
		}
		return nil, err
	}

	query := `SELECT id::text, entity_name, entity_identifier::text, project_id::text, workspace_id::text, created_at, updated_at
		FROM user_recent_visits 
		WHERE user_id::text = $1 AND workspace_id = (SELECT id FROM workspaces WHERE slug = $2 AND deleted_at IS NULL)
		AND entity_name IN ('issue', 'page', 'project')`
	args := []any{userID, slug}

	if entityName != "" {
		query += ` AND entity_name = $3`
		args = append(args, entityName)
	}

	query += ` ORDER BY updated_at DESC LIMIT 20`

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list recent visits: %w", err)
	}
	defer rows.Close()

	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, eName, eIdent string
		var projectID *string
		var workspaceID string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &eName, &eIdent, &projectID, &workspaceID, &createdAt, &updatedAt); err == nil {
			result = append(result, map[string]any{
				"id":                id,
				"entity_name":       eName,
				"entity_identifier": eIdent,
				"project":           projectID,
				"workspace":         workspaceID,
				"created_at":        createdAt,
				"updated_at":        updatedAt,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
