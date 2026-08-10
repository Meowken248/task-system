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

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, payload WritePayload) (Item, error) {
	err := s.authorize(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Item{}, err
	}

	if payload.Name == nil || *payload.Name == "" {
		return Item{}, fmt.Errorf("name is required")
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)

	var workspaceID string
	err = tx.QueryRow(ctx, `SELECT workspace_id FROM projects WHERE id::text=$1 AND deleted_at IS NULL`, projectID).Scan(&workspaceID)
	if err != nil {
		return Item{}, err
	}

	var userID string
	err = tx.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key=$1`, sessionKey).Scan(&userID)
	if err != nil {
		return Item{}, err
	}

	color := "#000000"
	if payload.Color != nil {
		color = *payload.Color
	}

	// Let's use gen_random_uuid() provided by pgcrypto
	_, err = tx.Exec(ctx, `INSERT INTO labels (id, name, color, project_id, workspace_id, created_by_id, updated_by_id, created_at, updated_at) 
		VALUES (gen_random_uuid(), $1, $2, $3::uuid, $4::uuid, $5::uuid, $5::uuid, NOW(), NOW())`,
		*payload.Name, color, projectID, workspaceID, userID)
	if err != nil {
		return Item{}, err
	}

	var newItem Item
	err = tx.QueryRow(ctx, `SELECT parent_id::text, name, color, id::text, project_id::text, workspace_id::text, sort_order 
		FROM labels WHERE name=$1 AND project_id::text=$2 ORDER BY created_at DESC LIMIT 1`, *payload.Name, projectID).
		Scan(&newItem.Parent, &newItem.Name, &newItem.Color, &newItem.ID, &newItem.ProjectID, &newItem.WorkspaceID, &newItem.SortOrder)
	if err != nil {
		return Item{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return Item{}, err
	}
	return newItem, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, labelID string, payload WritePayload) (Item, error) {
	err := s.authorize(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Item{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)

	var userID string
	err = tx.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key=$1`, sessionKey).Scan(&userID)
	if err != nil {
		return Item{}, err
	}

	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM labels WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, labelID, projectID).Scan(&exists)
	if err != nil {
		return Item{}, err
	}
	if !exists {
		return Item{}, ErrNotFound
	}

	query := `UPDATE labels SET updated_at=NOW(), updated_by_id=$2 `
	args := []any{labelID, userID}
	idx := 3

	if payload.Name != nil {
		query += fmt.Sprintf(", name=$%d ", idx)
		args = append(args, *payload.Name)
		idx++
	}
	if payload.Color != nil {
		query += fmt.Sprintf(", color=$%d ", idx)
		args = append(args, *payload.Color)
		idx++
	}

	query += fmt.Sprintf(` WHERE id::text=$1 AND project_id::text=$%d AND deleted_at IS NULL`, idx)
	args = append(args, projectID)

	_, err = tx.Exec(ctx, query, args...)
	if err != nil {
		return Item{}, err
	}

	var updatedItem Item
	err = tx.QueryRow(ctx, `SELECT parent_id::text, name, color, id::text, project_id::text, workspace_id::text, sort_order 
		FROM labels WHERE id::text=$1 AND deleted_at IS NULL`, labelID).
		Scan(&updatedItem.Parent, &updatedItem.Name, &updatedItem.Color, &updatedItem.ID, &updatedItem.ProjectID, &updatedItem.WorkspaceID, &updatedItem.SortOrder)
	if err != nil {
		return Item{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return Item{}, err
	}
	return updatedItem, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, labelID string) error {
	err := s.authorize(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var userID string
	err = tx.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key=$1`, sessionKey).Scan(&userID)
	if err != nil {
		return err
	}

	res, err := tx.Exec(ctx, `UPDATE labels SET deleted_at=NOW(), updated_at=NOW(), updated_by_id=$2 WHERE id::text=$1 AND project_id::text=$3 AND deleted_at IS NULL`, labelID, userID, projectID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}

	return tx.Commit(ctx)
}
