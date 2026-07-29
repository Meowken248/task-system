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

type Store interface {
	ListEstimates(ctx context.Context, projectID string) ([]Estimate, error)
	ListEstimatePoints(ctx context.Context, estimateID string) ([]EstimatePoint, error)
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) ListEstimates(ctx context.Context, projectID string) ([]Estimate, error) {
	query := `
		SELECT id, workspace_id, project_id, name, description, type, last_used, created_at, updated_at
		FROM estimates
		WHERE project_id = $1 AND deleted_at IS NULL
		ORDER BY name ASC
	`
	rows, err := s.Pool.Query(ctx, query, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Estimate
	for rows.Next() {
		var e Estimate
		err := rows.Scan(
			&e.ID, &e.WorkspaceID, &e.ProjectID, &e.Name, &e.Description, &e.Type,
			&e.LastUsed, &e.CreatedAt, &e.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, e)
	}
	if results == nil {
		results = []Estimate{}
	}
	return results, nil
}

func (s PostgreSQLStore) ListEstimatePoints(ctx context.Context, estimateID string) ([]EstimatePoint, error) {
	query := `
		SELECT id, workspace_id, project_id, estimate_id, key, description, value, created_at, updated_at
		FROM estimate_points
		WHERE estimate_id = $1 AND deleted_at IS NULL
		ORDER BY value ASC
	`
	rows, err := s.Pool.Query(ctx, query, estimateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []EstimatePoint
	for rows.Next() {
		var ep EstimatePoint
		err := rows.Scan(
			&ep.ID, &ep.WorkspaceID, &ep.ProjectID, &ep.EstimateID, &ep.Key, &ep.Description,
			&ep.Value, &ep.CreatedAt, &ep.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, ep)
	}
	if results == nil {
		results = []EstimatePoint{}
	}
	return results, nil
}
