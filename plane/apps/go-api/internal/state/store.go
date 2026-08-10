package state

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
	ErrNotFound     = errors.New("state not found")
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) resolveUser(ctx context.Context, sessionKey, slug, projectID string) (string, error) {
	if s.Pool == nil {
		return "", errors.New("state database unavailable")
	}
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text = $3 AND p.workspace_id = w.id AND p.archived_at IS NULL AND p.deleted_at IS NULL
		JOIN project_members pm ON pm.project_id = p.id AND pm.member_id::text = s.user_id
			AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`, sessionKey, slug, projectID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		var validSession bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions
			WHERE session_key = $1 AND expire_date > NOW())`, sessionKey).Scan(&validSession); checkErr != nil {
			return "", fmt.Errorf("check state session: %w", checkErr)
		}
		if validSession {
			return "", ErrForbidden
		}
		return "", ErrUnauthorized
	}
	if err != nil {
		return "", fmt.Errorf("resolve state access: %w", err)
	}
	return userID, nil
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]map[string]any, error) {
	if _, err := s.resolveUser(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id::text, project_id::text, workspace_id::text, name, color,
		"group", "default", description, sequence
		FROM states WHERE project_id::text = $1 AND is_triage = FALSE AND deleted_at IS NULL
		ORDER BY "group", sequence, created_at`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list states: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	groupCounts := make(map[string]int)
	for rows.Next() {
		item, scanErr := scanState(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		groupCounts[item["group"].(string)]++
		result = append(result, item)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate states: %w", err)
	}
	groupPosition := make(map[string]int)
	for _, item := range result {
		group := item["group"].(string)
		groupPosition[group]++
		item["order"] = float64(groupPosition[group]) / float64(groupCounts[group])
	}
	return result, nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID, stateID string) (map[string]any, error) {
	if _, err := s.resolveUser(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	item, err := scanState(s.Pool.QueryRow(ctx, `SELECT id::text, project_id::text, workspace_id::text, name, color,
		"group", "default", description, sequence
		FROM states WHERE project_id::text = $1 AND id::text = $2 AND is_triage = FALSE AND deleted_at IS NULL`, projectID, stateID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	item["order"] = float64(0)
	return item, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanState(row rowScanner) (map[string]any, error) {
	var id, projectID, workspaceID, name, color, group, description string
	var isDefault bool
	var sequence float64
	if err := row.Scan(&id, &projectID, &workspaceID, &name, &color, &group, &isDefault, &description, &sequence); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "project_id": projectID, "workspace_id": workspaceID, "name": name,
		"color": color, "group": group, "default": isDefault, "description": description,
		"sequence": sequence,
	}, nil
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, payload WritePayload) (map[string]any, error) {
	userID, err := s.resolveUser(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	if payload.Name == nil || *payload.Name == "" {
		return nil, fmt.Errorf("name is required")
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var workspaceID string
	err = tx.QueryRow(ctx, `SELECT workspace_id FROM projects WHERE id::text=$1 AND deleted_at IS NULL`, projectID).Scan(&workspaceID)
	if err != nil {
		return nil, err
	}

	color := "#000000"
	if payload.Color != nil {
		color = *payload.Color
	}
	desc := ""
	if payload.Description != nil {
		desc = *payload.Description
	}
	seq := float64(15000)
	if payload.Sequence != nil {
		seq = *payload.Sequence
	}
	group := "backlog"
	if payload.Group != nil {
		group = *payload.Group
	}
	isDef := false
	if payload.Default != nil {
		isDef = *payload.Default
	}

	_, err = tx.Exec(ctx, `INSERT INTO states (id, name, color, description, sequence, "group", "default", is_triage, project_id, workspace_id, created_by_id, updated_by_id, created_at, updated_at) 
		VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, FALSE, $7::uuid, $8::uuid, $9::uuid, $9::uuid, NOW(), NOW())`,
		*payload.Name, color, desc, seq, group, isDef, projectID, workspaceID, userID)
	if err != nil {
		return nil, err
	}

	item, err := scanState(tx.QueryRow(ctx, `SELECT id::text, project_id::text, workspace_id::text, name, color,
		"group", "default", description, sequence
		FROM states WHERE name=$1 AND project_id::text=$2 ORDER BY created_at DESC LIMIT 1`, *payload.Name, projectID))
	if err != nil {
		return nil, err
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	item["order"] = float64(0)
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, stateID string, payload WritePayload) (map[string]any, error) {
	userID, err := s.resolveUser(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM states WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, stateID, projectID).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	query := `UPDATE states SET updated_at=NOW(), updated_by_id=$2 `
	args := []any{stateID, userID}
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
	if payload.Description != nil {
		query += fmt.Sprintf(", description=$%d ", idx)
		args = append(args, *payload.Description)
		idx++
	}
	if payload.Sequence != nil {
		query += fmt.Sprintf(", sequence=$%d ", idx)
		args = append(args, *payload.Sequence)
		idx++
	}
	if payload.Group != nil {
		query += fmt.Sprintf(", \"group\"=$%d ", idx)
		args = append(args, *payload.Group)
		idx++
	}
	if payload.Default != nil {
		query += fmt.Sprintf(", \"default\"=$%d ", idx)
		args = append(args, *payload.Default)
		idx++
	}

	query += fmt.Sprintf(` WHERE id::text=$1 AND project_id::text=$%d AND deleted_at IS NULL`, idx)
	args = append(args, projectID)

	_, err = tx.Exec(ctx, query, args...)
	if err != nil {
		return nil, err
	}

	item, err := scanState(tx.QueryRow(ctx, `SELECT id::text, project_id::text, workspace_id::text, name, color,
		"group", "default", description, sequence
		FROM states WHERE id::text=$1 AND deleted_at IS NULL`, stateID))
	if err != nil {
		return nil, err
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	item["order"] = float64(0)
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, stateID string) error {
	userID, err := s.resolveUser(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// In Plane, if a state is deleted, issues might need to be moved, but the basic delete is soft-delete.
	res, err := tx.Exec(ctx, `UPDATE states SET deleted_at=NOW(), updated_at=NOW(), updated_by_id=$2 WHERE id::text=$1 AND project_id::text=$3 AND deleted_at IS NULL`, stateID, userID, projectID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}

	return tx.Commit(ctx)
}
