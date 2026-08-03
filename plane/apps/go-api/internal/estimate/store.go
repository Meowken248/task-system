package estimate

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Estimate struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace"`
	ProjectID   string    `json:"project"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Type        string    `json:"type"`
	LastUsed    bool      `json:"last_used"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type EstimatePoint struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace"`
	ProjectID   string    `json:"project"`
	EstimateID  string    `json:"estimate"`
	Key         int       `json:"key"`
	Description string    `json:"description"`
	Value       string    `json:"value"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]Estimate, error) {
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM sessions session
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN project_members pm ON pm.project_id::text=$3 AND pm.member_id=session.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE session.session_key=$1 AND session.expire_date>NOW()
	)`, sessionKey, slug, projectID).Scan(&allowed)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrForbidden
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id,workspace_id,project_id,name,description,type,last_used,created_at,updated_at
		FROM estimates WHERE project_id=$1 AND deleted_at IS NULL ORDER BY name ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Estimate, 0)
	for rows.Next() {
		var e Estimate
		if err := rows.Scan(&e.ID, &e.WorkspaceID, &e.ProjectID, &e.Name, &e.Description, &e.Type, &e.LastUsed, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, e)
	}
	return items, rows.Err()
}
