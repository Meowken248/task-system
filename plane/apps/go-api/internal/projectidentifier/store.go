package projectidentifier

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s *PostgreSQLStore) resolve(ctx context.Context, sessionKey string, slug string) (workspaceID string, userID string, hasAccess bool, err error) {
	if sessionKey == "" {
		return "", "", false, ErrUnauthorized
	}
	query := `
		SELECT
			w.id AS workspace_id,
			s.session_data->>'_auth_user_id' AS user_id,
			wm.id IS NOT NULL AS has_access
		FROM django_session s
		LEFT JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		LEFT JOIN workspace_members wm ON wm.workspace_id = w.id 
			AND wm.member_id = (s.session_data->>'_auth_user_id')::uuid 
			AND wm.is_active = true 
			AND wm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > CURRENT_TIMESTAMP
	`
	err = s.Pool.QueryRow(ctx, query, sessionKey, slug).Scan(&workspaceID, &userID, &hasAccess)
	if err != nil {
		return "", "", false, ErrUnauthorized
	}
	if !hasAccess {
		return "", "", false, ErrForbidden
	}
	return workspaceID, userID, true, nil
}

func (s *PostgreSQLStore) CheckExists(ctx context.Context, sessionKey, slug, name string) ([]ProjectIdentifier, error) {
	workspaceID, _, hasAccess, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	if !hasAccess {
		return nil, ErrForbidden
	}

	query := `
		SELECT id, name, project_id
		FROM project_identifiers
		WHERE workspace_id = $1 AND name = $2 AND deleted_at IS NULL
	`

	rows, err := s.Pool.Query(ctx, query, workspaceID, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var identifiers []ProjectIdentifier
	for rows.Next() {
		var id ProjectIdentifier
		if err := rows.Scan(&id.ID, &id.Name, &id.Project); err != nil {
			return nil, err
		}
		identifiers = append(identifiers, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return identifiers, nil
}

func (s *PostgreSQLStore) Delete(ctx context.Context, sessionKey, slug, name string) error {
	workspaceID, _, hasAccess, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	if !hasAccess {
		return ErrForbidden
	}

	// Check if associated with an existing project
	queryCheck := `
		SELECT 1
		FROM projects
		WHERE workspace_id = $1 AND identifier = $2 AND deleted_at IS NULL
	`
	var exists int
	err = s.Pool.QueryRow(ctx, queryCheck, workspaceID, name).Scan(&exists)
	if err == nil {
		// Found an existing project, cannot delete identifier
		return ErrInUse
	}

	// Delete from project_identifiers
	queryDelete := `
		DELETE FROM project_identifiers
		WHERE workspace_id = $1 AND name = $2
	`
	_, err = s.Pool.Exec(ctx, queryDelete, workspaceID, name)
	return err
}
