package analytic

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AnalyticView struct {
	ID          string                 `json:"id"`
	WorkspaceID string                 `json:"workspace"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Query       map[string]interface{} `json:"query"`
	QueryDict   map[string]interface{} `json:"query_dict"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, workspaceSlug string) ([]AnalyticView, error) {
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM sessions session
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id=NULLIF(session.user_id, '')::uuid
			AND wm.is_active=TRUE AND wm.deleted_at IS NULL
		WHERE session.session_key=$1 AND session.expire_date>NOW()
	)`, sessionKey, workspaceSlug).Scan(&allowed)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrForbidden
	}

	rows, err := s.Pool.Query(ctx, `
		SELECT av.id, av.workspace_id, av.name, av.description, av.query, av.query_dict, av.created_at, av.updated_at
		FROM analytic_views av
		JOIN workspaces w ON w.id = av.workspace_id
		WHERE w.slug = $1 AND av.deleted_at IS NULL
		ORDER BY av.created_at DESC
	`, workspaceSlug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]AnalyticView, 0)
	for rows.Next() {
		var a AnalyticView
		if err := rows.Scan(&a.ID, &a.WorkspaceID, &a.Name, &a.Description, &a.Query, &a.QueryDict,
			&a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		results = append(results, a)
	}
	return results, rows.Err()
}
