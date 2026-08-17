package projectinvite

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
	ErrNotFound     = errors.New("workspace or invitation not found")
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

type Invitation struct {
	ID          string         `json:"id"`
	Email       string         `json:"email"`
	Accepted    bool           `json:"accepted"`
	Token       string         `json:"token"`
	Message     *string        `json:"message"`
	RespondedAt *time.Time     `json:"responded_at"`
	Role        int16          `json:"role"`
	Project     ProjectLite    `json:"project"`
	Workspace   WorkspaceLite  `json:"workspace"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type ProjectLite struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Identifier string `json:"identifier"`
}

type WorkspaceLite struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type session struct {
	UserID        string
	Email         string
	WorkspaceID   string
	WorkspaceRole int16
}

func (s PostgreSQLStore) resolve(ctx context.Context, sessionKey, slug string) (session, error) {
	if s.Pool == nil {
		return session{}, errors.New("project invitation database unavailable")
	}
	if sessionKey == "" {
		return session{}, ErrUnauthorized
	}
	var result session
	err := s.Pool.QueryRow(ctx, `
		SELECT s.user_id, u.email, w.id::text, wm.role
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.member_id = s.user_id
			AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()
	`, sessionKey, slug).Scan(&result.UserID, &result.Email, &result.WorkspaceID, &result.WorkspaceRole)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var valid bool
			if errChk := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); errChk == nil && !valid {
				return session{}, ErrUnauthorized
			}
			return session{}, ErrForbidden
		}
		return session{}, fmt.Errorf("resolve project invitation session: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string) ([]Invitation, error) {
	current, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}

	rows, err := s.Pool.Query(ctx, `
		SELECT pmi.id::text, pmi.email, pmi.accepted, pmi.token, pmi.message, pmi.responded_at, pmi.role, pmi.created_at, pmi.updated_at,
		       p.id::text, p.name, p.identifier,
		       w.id::text, w.name, w.slug
		FROM project_member_invites pmi
		JOIN projects p ON p.id = pmi.project_id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN workspaces w ON w.id = pmi.workspace_id AND w.deleted_at IS NULL
		WHERE pmi.workspace_id::text = $1 AND pmi.email = $2 AND pmi.responded_at IS NULL
		ORDER BY pmi.created_at DESC
	`, current.WorkspaceID, current.Email)
	if err != nil {
		return nil, fmt.Errorf("list user project invitations: %w", err)
	}
	defer rows.Close()

	result := make([]Invitation, 0)
	for rows.Next() {
		var item Invitation
		if err := rows.Scan(
			&item.ID, &item.Email, &item.Accepted, &item.Token, &item.Message, &item.RespondedAt, &item.Role, &item.CreatedAt, &item.UpdatedAt,
			&item.Project.ID, &item.Project.Name, &item.Project.Identifier,
			&item.Workspace.ID, &item.Workspace.Name, &item.Workspace.Slug,
		); err != nil {
			return nil, fmt.Errorf("scan user project invitation: %w", err)
		}
		result = append(result, item)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user project invitations: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) BulkJoin(ctx context.Context, sessionKey, slug string, projectIDs []string) error {
	if len(projectIDs) == 0 {
		return nil
	}

	current, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin bulk join projects: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check permissions and network on all projects
	rows, err := tx.Query(ctx, `
		SELECT id::text, network FROM projects 
		WHERE id::text = ANY($1) AND workspace_id::text = $2 AND deleted_at IS NULL
	`, projectIDs, current.WorkspaceID)
	if err != nil {
		return fmt.Errorf("query projects for bulk join: %w", err)
	}
	defer rows.Close()

	validProjects := make([]string, 0)
	for rows.Next() {
		var pid string
		var network int
		if err := rows.Scan(&pid, &network); err != nil {
			return fmt.Errorf("scan project bulk join: %w", err)
		}
		// SECRET network projects (network=0) require admin role
		if network == 0 && current.WorkspaceRole != 20 {
			return fmt.Errorf("only workspace admins can join private project %s", pid)
		}
		validProjects = append(validProjects, pid)
	}
	if err = rows.Err(); err != nil {
		return fmt.Errorf("iterate projects bulk join: %w", err)
	}

	// Bulk Update existing ProjectMember entries
	_, err = tx.Exec(ctx, `
		UPDATE project_members 
		SET is_active = TRUE, updated_at = NOW(), updated_by_id::text = $1
		WHERE workspace_id::text = $2 AND project_id::text = ANY($3) AND member_id::text = $1
	`, current.UserID, current.WorkspaceID, validProjects)
	if err != nil {
		return fmt.Errorf("bulk update project members: %w", err)
	}

	// Bulk Insert new ProjectMember entries
	for _, pid := range validProjects {
		_, err = tx.Exec(ctx, `
			INSERT INTO project_members (workspace_id, project_id, member_id, role, is_active, created_by_id, updated_by_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, TRUE, $3, $3, NOW(), NOW())
			ON CONFLICT (workspace_id, project_id, member_id) DO NOTHING
		`, current.WorkspaceID, pid, current.UserID, current.WorkspaceRole)
		if err != nil {
			return fmt.Errorf("bulk insert project member: %w", err)
		}

		// Insert project user property
		_, err = tx.Exec(ctx, `
			INSERT INTO project_user_properties (workspace_id, project_id, user_id, sort_order, created_by_id, updated_by_id, created_at, updated_at)
			SELECT $1, $2, $3, COALESCE(MIN(sort_order), 65535) - 65535, $3, $3, NOW(), NOW()
			FROM project_user_properties WHERE workspace_id::text = $1 AND user_id::text = $3
			ON CONFLICT DO NOTHING
		`, current.WorkspaceID, pid, current.UserID)
		if err != nil {
			return fmt.Errorf("bulk insert project user property: %w", err)
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit bulk join projects: %w", err)
	}
	return nil
}
