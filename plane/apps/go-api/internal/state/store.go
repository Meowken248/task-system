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
