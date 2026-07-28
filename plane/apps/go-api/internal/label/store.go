package label

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("label not found")
)

type Item struct {
	Parent      *string `json:"parent"`
	Name        string  `json:"name"`
	Color       string  `json:"color"`
	ID          string  `json:"id"`
	ProjectID   string  `json:"project_id"`
	WorkspaceID string  `json:"workspace_id"`
	SortOrder   float64 `json:"sort_order"`
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) authorize(ctx context.Context, sessionKey, slug, projectID string) error {
	if s.Pool == nil {
		return errors.New("label database unavailable")
	}
	if sessionKey == "" {
		return ErrUnauthorized
	}
	var allowed bool
	if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW())`, sessionKey, slug, projectID).Scan(&allowed); err != nil {
		return fmt.Errorf("resolve label access: %w", err)
	}
	if allowed {
		return nil
	}
	var validSession bool
	if err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&validSession); err != nil {
		return fmt.Errorf("check label session: %w", err)
	}
	if validSession {
		return ErrForbidden
	}
	return ErrUnauthorized
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]Item, error) {
	if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT parent_id::text, name, color, id::text, project_id::text, workspace_id::text, sort_order
		FROM labels WHERE project_id::text=$1 AND deleted_at IS NULL ORDER BY sort_order, created_at`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list labels: %w", err)
	}
	defer rows.Close()
	result := make([]Item, 0)
	for rows.Next() {
		item, scanErr := scan(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, item)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate labels: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID, labelID string) (Item, error) {
	if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
		return Item{}, err
	}
	item, err := scan(s.Pool.QueryRow(ctx, `SELECT parent_id::text, name, color, id::text, project_id::text, workspace_id::text, sort_order
		FROM labels WHERE project_id::text=$1 AND id::text=$2 AND deleted_at IS NULL`, projectID, labelID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, err
}

type rowScanner interface{ Scan(...any) error }

func scan(row rowScanner) (Item, error) {
	var item Item
	if err := row.Scan(&item.Parent, &item.Name, &item.Color, &item.ID, &item.ProjectID, &item.WorkspaceID, &item.SortOrder); err != nil {
		return Item{}, err
	}
	return item, nil
}
