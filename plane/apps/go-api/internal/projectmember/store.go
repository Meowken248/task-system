package projectmember

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
	ErrForbidden    = errors.New("project access denied")
)

type Membership struct {
	ID           string    `json:"id"`
	Member       string    `json:"member"`
	Role         int16     `json:"role"`
	OriginalRole int16     `json:"original_role"`
	CreatedAt    time.Time `json:"created_at"`
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID string) (Membership, error) {
	if s.Pool == nil {
		return Membership{}, errors.New("project member database unavailable")
	}
	if sessionKey == "" {
		return Membership{}, ErrUnauthorized
	}

	var item Membership
	err := s.Pool.QueryRow(ctx, `SELECT pm.id::text, pm.member_id::text, pm.role, pm.created_at
		FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text = $3 AND p.workspace_id = w.id
			AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id = p.id AND pm.member_id::text = s.user_id
			AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`,
		sessionKey, slug, projectID,
	).Scan(&item.ID, &item.Member, &item.Role, &item.CreatedAt)
	if err == nil {
		item.OriginalRole = item.Role
		return item, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Membership{}, fmt.Errorf("get current project member: %w", err)
	}

	var validSession bool
	if err = s.Pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key = $1 AND expire_date > NOW())`,
		sessionKey,
	).Scan(&validSession); err != nil {
		return Membership{}, fmt.Errorf("check current project member session: %w", err)
	}
	if !validSession {
		return Membership{}, ErrUnauthorized
	}
	return Membership{}, ErrForbidden
}
func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]Membership, error) {
	if s.Pool == nil {
		return nil, errors.New("project member database unavailable")
	}
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text = $3 AND p.workspace_id = w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id = p.id AND pm.member_id::text = s.user_id
			AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW())`, sessionKey, slug, projectID).Scan(&allowed)
	if err != nil {
		return nil, fmt.Errorf("resolve project member access: %w", err)
	}
	if !allowed {
		var validSession bool
		if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key = $1 AND expire_date > NOW())`, sessionKey).Scan(&validSession); err != nil {
			return nil, fmt.Errorf("check project member session: %w", err)
		}
		if validSession {
			return nil, ErrForbidden
		}
		return nil, ErrUnauthorized
	}
	rows, err := s.Pool.Query(ctx, `SELECT pm.id::text, pm.member_id::text, pm.role, pm.created_at
		FROM project_members pm
		JOIN projects p ON p.id = pm.project_id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN workspaces w ON w.id = pm.workspace_id AND w.slug = $1 AND w.deleted_at IS NULL
		JOIN users u ON u.id = pm.member_id AND u.is_bot = FALSE
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.member_id = pm.member_id
			AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		WHERE pm.project_id::text = $2 AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		ORDER BY pm.created_at, pm.id`, slug, projectID)
	if err != nil {
		return nil, fmt.Errorf("list project members: %w", err)
	}
	defer rows.Close()
	result := make([]Membership, 0)
	for rows.Next() {
		var item Membership
		if err = rows.Scan(&item.ID, &item.Member, &item.Role, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan project member: %w", err)
		}
		item.OriginalRole = item.Role
		result = append(result, item)
	}
	if err = rows.Err(); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("iterate project members: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) WorkspaceListForSession(ctx context.Context, sessionKey, slug string) (map[string][]Membership, error) {
	if s.Pool == nil {
		return nil, errors.New("project member database unavailable")
	}
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}

	// First verify session and get user ID
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key = $1 AND expire_date > NOW()`, sessionKey).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("check session: %w", err)
	}

	// Verify workspace access (must be active workspace member)
	var hasWorkspaceAccess bool
	err = s.Pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM workspace_members wm
		JOIN workspaces w ON w.id = wm.workspace_id AND w.deleted_at IS NULL
		WHERE wm.member_id::text = $1 AND wm.is_active = TRUE AND wm.deleted_at IS NULL AND w.slug = $2
	)`, userID, slug).Scan(&hasWorkspaceAccess)
	if err != nil {
		return nil, fmt.Errorf("check workspace access: %w", err)
	}
	if !hasWorkspaceAccess {
		return nil, ErrForbidden
	}

	// Fetch all project members for all projects in this workspace where the user is an active member of the project
	rows, err := s.Pool.Query(ctx, `
		SELECT pm.id::text, pm.member_id::text, pm.role, pm.created_at, p.id::text AS project_id
		FROM project_members pm
		JOIN projects p ON p.id = pm.project_id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN workspaces w ON w.id = pm.workspace_id AND w.slug = $1 AND w.deleted_at IS NULL
		WHERE pm.is_active = TRUE AND pm.deleted_at IS NULL
		AND EXISTS (
			-- The current user must be an active member of this project
			SELECT 1 FROM project_members pm2
			WHERE pm2.project_id = pm.project_id AND pm2.member_id::text = $2 
			AND pm2.is_active = TRUE AND pm2.deleted_at IS NULL
		)
		ORDER BY pm.created_at
	`, slug, userID)
	if err != nil {
		return nil, fmt.Errorf("list workspace project members: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]Membership)
	for rows.Next() {
		var item Membership
		var projectID string
		if err := rows.Scan(&item.ID, &item.Member, &item.Role, &item.CreatedAt, &projectID); err != nil {
			return nil, fmt.Errorf("scan workspace project member: %w", err)
		}
		item.OriginalRole = item.Role
		result[projectID] = append(result[projectID], item)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspace project members: %w", err)
	}
	return result, nil
}

type session struct {
	UserID        string
	WorkspaceID   string
	ProjectID     string
	WorkspaceRole int16
	ProjectRole   int16
}

func (s PostgreSQLStore) resolve(ctx context.Context, sessionKey, slug, projectID string) (session, error) {
	if s.Pool == nil {
		return session{}, errors.New("project member database unavailable")
	}
	if sessionKey == "" {
		return session{}, ErrUnauthorized
	}
	var result session
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, p.id::text, wm.role, COALESCE(pm.role, 0)
		FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.member_id::text = s.user_id
			AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		JOIN projects p ON p.id::text = $3 AND p.workspace_id = w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id::text = s.user_id
			AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`, sessionKey, slug, projectID).
		Scan(&result.UserID, &result.WorkspaceID, &result.ProjectID, &result.WorkspaceRole, &result.ProjectRole)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			var valid bool
			if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); err != nil {
				return session{}, fmt.Errorf("check project member session: %w", err)
			}
			if !valid {
				return session{}, ErrUnauthorized
			}
			return session{}, ErrForbidden
		}
		return session{}, fmt.Errorf("resolve project member session: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) BulkCreate(ctx context.Context, sessionKey, slug, projectID string, members []map[string]any) error {
	current, err := s.resolve(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if current.ProjectRole != 20 {
		return ErrForbidden
	}
	if len(members) == 0 {
		return errors.New("at least one member is required")
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin bulk create project members: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, m := range members {
		memberID, okID := m["member_id"].(string)
		roleF, okRole := m["role"].(float64)
		if !okID || !okRole {
			continue
		}
		role := int16(roleF)

		var workspaceRole int16
		err = tx.QueryRow(ctx, `SELECT role FROM workspace_members WHERE workspace_id::text = $1 AND member_id::text = $2 AND is_active = TRUE AND deleted_at IS NULL`, current.WorkspaceID, memberID).Scan(&workspaceRole)
		if err != nil {
			return fmt.Errorf("check workspace member role: %w", err)
		}
		if workspaceRole == 20 && (role == 5 || role == 15) {
			return errors.New("cannot add a user with role lower than the workspace role")
		}
		if workspaceRole == 5 && (role == 15 || role == 20) {
			return errors.New("cannot add a user with role higher than the workspace role")
		}

		// Insert or Update project member
		_, err = tx.Exec(ctx, `
			INSERT INTO project_members (id, workspace_id, project_id, member_id, role, is_active, created_by_id, updated_by_id, created_at, updated_at,
				view_props, default_props, sort_order, preferences)
			VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, TRUE, $5::uuid, $5::uuid, NOW(), NOW(),
				'{}'::jsonb, '{}'::jsonb, 65535, '{}'::jsonb)
			ON CONFLICT (project_id, member_id) WHERE deleted_at IS NULL DO UPDATE SET
				role = EXCLUDED.role,
				is_active = TRUE,
				deleted_at = NULL,
				updated_by_id = EXCLUDED.updated_by_id,
				updated_at = EXCLUDED.updated_at
		`, current.WorkspaceID, current.ProjectID, memberID, role, current.UserID)
		if err != nil {
			return fmt.Errorf("upsert project member: %w", err)
		}

		// Insert or Ignore project user property
		_, err = tx.Exec(ctx, `
			INSERT INTO project_user_properties (id, workspace_id, project_id, user_id, sort_order,
				filters, rich_filters, display_filters, display_properties, preferences,
				created_by_id, updated_by_id, created_at, updated_at)
			VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 65535,
				'{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
				$4::uuid, $4::uuid, NOW(), NOW())
			ON CONFLICT (user_id, project_id) WHERE deleted_at IS NULL DO NOTHING
		`, current.WorkspaceID, current.ProjectID, memberID, current.UserID)
		if err != nil {
			return fmt.Errorf("insert project user property: %w", err)
		}

		// Insert email log
		_, _ = tx.Exec(ctx, `INSERT INTO email_notification_logs (id, receiver_id, triggered_by_id, entity, entity_name, created_at, updated_at) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'PROJECT', $3, NOW(), NOW())`, memberID, current.UserID, current.ProjectID)
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit bulk create project members: %w", err)
	}
	return nil
}

func (s PostgreSQLStore) UpdateRole(ctx context.Context, sessionKey, slug, projectID, memberID string, role int16) (Membership, error) {
	current, err := s.resolve(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Membership{}, err
	}
	if current.ProjectRole != 20 {
		return Membership{}, ErrForbidden
	}
	if current.UserID == memberID {
		return Membership{}, errors.New("cannot update own role")
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Membership{}, fmt.Errorf("begin update project member role: %w", err)
	}
	defer tx.Rollback(ctx)

	var targetRole int16
	err = tx.QueryRow(ctx, `SELECT role FROM project_members WHERE project_id::text = $1 AND member_id::text = $2 AND is_active = TRUE AND deleted_at IS NULL FOR UPDATE`, current.ProjectID, memberID).Scan(&targetRole)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Membership{}, errors.New("project member not found")
		}
		return Membership{}, fmt.Errorf("lock project member: %w", err)
	}

	var workspaceRole int16
	err = tx.QueryRow(ctx, `SELECT role FROM workspace_members WHERE workspace_id::text = $1 AND member_id::text = $2 AND is_active = TRUE AND deleted_at IS NULL`, current.WorkspaceID, memberID).Scan(&workspaceRole)
	if err != nil {
		return Membership{}, fmt.Errorf("check target workspace role: %w", err)
	}

	if workspaceRole == 20 && (role == 5 || role == 15) {
		return Membership{}, errors.New("cannot downgrade below workspace role")
	}
	if workspaceRole == 5 && (role == 15 || role == 20) {
		return Membership{}, errors.New("cannot upgrade above workspace role")
	}

	_, err = tx.Exec(ctx, `UPDATE project_members SET role = $1, updated_at = NOW(), updated_by_id = $2 WHERE project_id::text = $3 AND member_id::text = $4`, role, current.UserID, current.ProjectID, memberID)
	if err != nil {
		return Membership{}, fmt.Errorf("update project member role: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return Membership{}, fmt.Errorf("commit update project member role: %w", err)
	}

	var result Membership
	err = s.Pool.QueryRow(ctx, `SELECT id::text, member_id::text, role, created_at FROM project_members WHERE project_id::text = $1 AND member_id::text = $2`, current.ProjectID, memberID).Scan(&result.ID, &result.Member, &result.Role, &result.CreatedAt)
	result.OriginalRole = result.Role
	return result, err
}

func (s PostgreSQLStore) Remove(ctx context.Context, sessionKey, slug, projectID, memberID string) error {
	current, err := s.resolve(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if current.ProjectRole != 20 {
		return ErrForbidden
	}
	return s.deactivate(ctx, current.WorkspaceID, current.ProjectID, memberID, current.UserID, false)
}

func (s PostgreSQLStore) Leave(ctx context.Context, sessionKey, slug, projectID string) error {
	current, err := s.resolve(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if current.ProjectRole == 0 {
		return ErrForbidden
	}
	return s.deactivate(ctx, current.WorkspaceID, current.ProjectID, current.UserID, current.UserID, true)
}

func (s PostgreSQLStore) deactivate(ctx context.Context, workspaceID, projectID, memberID, actorID string, isLeaving bool) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin deactivate project member: %w", err)
	}
	defer tx.Rollback(ctx)

	var role int16
	err = tx.QueryRow(ctx, `SELECT role FROM project_members WHERE project_id::text = $1 AND member_id::text = $2 AND is_active = TRUE AND deleted_at IS NULL FOR UPDATE`, projectID, memberID).Scan(&role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("project member not found")
		}
		return fmt.Errorf("lock project member: %w", err)
	}

	if role == 20 {
		var count int
		err = tx.QueryRow(ctx, `SELECT COUNT(*) FROM project_members WHERE project_id::text = $1 AND role = 20 AND is_active = TRUE AND deleted_at IS NULL`, projectID).Scan(&count)
		if err != nil {
			return fmt.Errorf("count project admins: %w", err)
		}
		if count <= 1 {
			if isLeaving {
				return errors.New("you are the only admin")
			}
			return errors.New("cannot remove the only admin")
		}
	}

	_, err = tx.Exec(ctx, `UPDATE project_members SET is_active = FALSE, updated_at = NOW(), updated_by_id = $1 WHERE project_id::text = $2 AND member_id::text = $3`, actorID, projectID, memberID)
	if err != nil {
		return fmt.Errorf("deactivate project member: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit deactivate project member: %w", err)
	}
	return nil
}

func (s PostgreSQLStore) UpdateViewProps(ctx context.Context, sessionKey, slug, projectID string, payload map[string]any) error {
	current, err := s.resolve(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if current.ProjectRole == 0 {
		return ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin update project member view props: %w", err)
	}
	defer tx.Rollback(ctx)

	var viewProps, defaultProps, preferences map[string]any
	var sortOrder float64
	err = tx.QueryRow(ctx, `SELECT view_props, default_props, preferences, sort_order FROM project_members WHERE project_id::text = $1 AND member_id::text = $2 AND is_active = TRUE AND deleted_at IS NULL FOR UPDATE`, current.ProjectID, current.UserID).Scan(&viewProps, &defaultProps, &preferences, &sortOrder)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("project member not found")
		}
		return fmt.Errorf("lock project member for view props update: %w", err)
	}

	if vp, ok := payload["view_props"].(map[string]any); ok {
		viewProps = vp
	}
	if dp, ok := payload["default_props"].(map[string]any); ok {
		defaultProps = dp
	}
	if p, ok := payload["preferences"].(map[string]any); ok {
		preferences = p
	}
	if so, ok := payload["sort_order"].(float64); ok {
		sortOrder = so
	}

	_, err = tx.Exec(ctx, `UPDATE project_members SET view_props = $1, default_props = $2, preferences = $3, sort_order = $4, updated_at = NOW(), updated_by_id = $5 WHERE project_id::text = $6 AND member_id::text = $7`, viewProps, defaultProps, preferences, sortOrder, current.UserID, current.ProjectID, current.UserID)
	if err != nil {
		return fmt.Errorf("update project member view props: %w", err)
	}

	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit update project member view props: %w", err)
	}
	return nil
}

func (s PostgreSQLStore) UserProjectRoles(ctx context.Context, sessionKey, slug string) (map[string]int16, error) {
	if s.Pool == nil {
		return nil, errors.New("project member database unavailable")
	}
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}

	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key = $1 AND expire_date > NOW()`, sessionKey).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUnauthorized
		}
		return nil, fmt.Errorf("check session: %w", err)
	}

	rows, err := s.Pool.Query(ctx, `
		SELECT pm.project_id::text, pm.role
		FROM project_members pm
		JOIN workspace_members wm ON wm.workspace_id = pm.workspace_id AND wm.member_id = pm.member_id
		JOIN workspaces w ON w.id = pm.workspace_id
		WHERE w.slug = $1
		  AND pm.member_id::text = $2
		  AND pm.is_active = TRUE
		  AND pm.deleted_at IS NULL
		  AND wm.is_active = TRUE
		  AND wm.deleted_at IS NULL
	`, slug, userID)
	if err != nil {
		return nil, fmt.Errorf("query user project roles: %w", err)
	}
	defer rows.Close()

	result := make(map[string]int16)
	for rows.Next() {
		var projectID string
		var role int16
		if err := rows.Scan(&projectID, &role); err != nil {
			return nil, fmt.Errorf("scan user project role: %w", err)
		}
		result[projectID] = role
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user project roles: %w", err)
	}
	return result, nil
}

