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

type Store interface {
	ListAnalyticViews(ctx context.Context, workspaceSlug string) ([]AnalyticView, error)
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) ListAnalyticViews(ctx context.Context, workspaceSlug string) ([]AnalyticView, error) {
	query := `
		SELECT av.id, av.workspace_id, av.name, av.description, av.query, av.query_dict, av.created_at, av.updated_at
		FROM analytic_views av
		JOIN workspaces w ON w.id = av.workspace_id
		WHERE w.slug = $1 AND av.deleted_at IS NULL
		ORDER BY av.created_at DESC
	`
	rows, err := s.Pool.Query(ctx, query, workspaceSlug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []AnalyticView
	for rows.Next() {
		var a AnalyticView
		err := rows.Scan(
			&a.ID, &a.WorkspaceID, &a.Name, &a.Description, &a.Query, &a.QueryDict,
			&a.CreatedAt, &a.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, a)
	}
	if results == nil {
		results = []AnalyticView{}
	}
	return results, nil
}
