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

func (s PostgreSQLStore) ProjectStatsForSession(ctx context.Context, sessionKey, workspaceSlug string, projectIDs []string, fields []string) ([]map[string]any, error) {
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

	validFields := map[string]bool{
		"total_issues":     true,
		"completed_issues": true,
		"total_members":    true,
		"total_cycles":     true,
		"total_modules":    true,
	}

	requestedFields := make(map[string]bool)
	for _, f := range fields {
		if f != "" && validFields[f] {
			requestedFields[f] = true
		}
	}
	if len(requestedFields) == 0 {
		requestedFields = validFields
	}

	query := `
		SELECT p.id::text
	`
	if requestedFields["total_issues"] {
		query += `, (SELECT COUNT(id) FROM issues WHERE project_id = p.id AND deleted_at IS NULL) as total_issues`
	}
	if requestedFields["completed_issues"] {
		query += `, (SELECT COUNT(i.id) FROM issues i JOIN states st ON st.id = i.state_id AND st.group IN ('completed', 'cancelled') AND st.deleted_at IS NULL WHERE i.project_id = p.id AND i.deleted_at IS NULL) as completed_issues`
	}
	if requestedFields["total_cycles"] {
		query += `, (SELECT COUNT(id) FROM cycles WHERE project_id = p.id AND deleted_at IS NULL) as total_cycles`
	}
	if requestedFields["total_modules"] {
		query += `, (SELECT COUNT(id) FROM modules WHERE project_id = p.id AND deleted_at IS NULL) as total_modules`
	}
	if requestedFields["total_members"] {
		query += `, (SELECT COUNT(pm.id) FROM project_members pm JOIN users u ON u.id = pm.member_id WHERE pm.project_id = p.id AND pm.is_active = TRUE AND pm.deleted_at IS NULL AND u.is_bot = FALSE) as total_members`
	}

	query += ` FROM projects p
		JOIN workspaces w ON w.id = p.workspace_id
		WHERE w.slug = $1 AND p.deleted_at IS NULL AND p.archived_at IS NULL
	`

	args := []any{workspaceSlug}
	if len(projectIDs) > 0 {
		query += ` AND p.id::text = ANY($2)`
		args = append(args, projectIDs)
	}

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []map[string]any
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		item := make(map[string]any)
		item["id"] = values[0]

		idx := 1
		if requestedFields["total_issues"] {
			item["total_issues"] = values[idx]
			idx++
		}
		if requestedFields["completed_issues"] {
			item["completed_issues"] = values[idx]
			idx++
		}
		if requestedFields["total_cycles"] {
			item["total_cycles"] = values[idx]
			idx++
		}
		if requestedFields["total_modules"] {
			item["total_modules"] = values[idx]
			idx++
		}
		if requestedFields["total_members"] {
			item["total_members"] = values[idx]
			idx++
		}
		results = append(results, item)
	}
	return results, rows.Err()
}
