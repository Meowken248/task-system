package workspacemember

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized            = errors.New("authentication required")
	ErrForbidden               = errors.New("workspace access denied")
	ErrNotFound                = errors.New("workspace member not found")
	ErrInvalidRole             = errors.New("invalid workspace role")
	ErrCannotUpdateSelf        = errors.New("cannot update own role")
	ErrCannotRemoveSelf        = errors.New("cannot remove self")
	ErrHigherRole              = errors.New("target has higher role")
	ErrOnlyProjectAdmin        = errors.New("target is only project admin")
	ErrLeavingOnlyProjectAdmin = errors.New("leaving user is only project admin")
	ErrOnlyWorkspaceAdmin      = errors.New("leaving user is only workspace admin")
)

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

type session struct {
	UserID, WorkspaceID, MemberID string
	Role                          int16
}

func (s PostgreSQLStore) resolve(ctx context.Context, sessionKey, slug string) (session, error) {
	if s.Pool == nil {
		return session{}, errors.New("workspace member database unavailable")
	}
	if sessionKey == "" {
		return session{}, ErrUnauthorized
	}
	var result session
	err := s.Pool.QueryRow(ctx, `SELECT sessions.user_id, w.id::text, wm.id::text, wm.role
		FROM sessions
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.member_id::text = sessions.user_id
			AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		WHERE sessions.session_key = $1 AND sessions.expire_date > NOW()`, sessionKey, slug).
		Scan(&result.UserID, &result.WorkspaceID, &result.MemberID, &result.Role)
	if err == nil {
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return session{}, fmt.Errorf("resolve workspace member session: %w", err)
	}
	var valid bool
	if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); err != nil {
		return session{}, fmt.Errorf("check workspace member session: %w", err)
	}
	if !valid {
		return session{}, ErrUnauthorized
	}
	return session{}, ErrForbidden
}

func (s PostgreSQLStore) List(ctx context.Context, sessionKey, slug string) ([]map[string]any, error) {
	current, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, memberQuery+` WHERE wm.workspace_id::text=$1 AND wm.is_active=TRUE
		AND wm.deleted_at IS NULL ORDER BY wm.created_at DESC`, current.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace members: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		item, scanErr := scanMember(rows, current.Role > 5)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, item)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspace members: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) Retrieve(ctx context.Context, sessionKey, slug, memberID string) (map[string]any, error) {
	current, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	return s.retrieve(ctx, current, memberID)
}

func (s PostgreSQLStore) retrieve(ctx context.Context, current session, memberID string) (map[string]any, error) {
	row := s.Pool.QueryRow(ctx, memberQuery+` WHERE wm.workspace_id::text=$1 AND wm.id::text=$2
		AND wm.is_active=TRUE AND wm.deleted_at IS NULL`, current.WorkspaceID, memberID)
	item, err := scanMember(row, current.Role > 5)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (s PostgreSQLStore) UpdateRole(ctx context.Context, sessionKey, slug, memberID string, role int16) (map[string]any, error) {
	if role != 5 && role != 15 && role != 20 {
		return nil, ErrInvalidRole
	}
	current, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	if current.Role != 20 {
		return nil, ErrForbidden
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin workspace member role update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var targetUserID string
	err = tx.QueryRow(ctx, `SELECT wm.member_id::text FROM workspace_members wm JOIN users u ON u.id=wm.member_id
		WHERE wm.workspace_id::text=$1 AND wm.id::text=$2 AND wm.is_active=TRUE
		AND wm.deleted_at IS NULL AND u.is_bot=FALSE FOR UPDATE`, current.WorkspaceID, memberID).Scan(&targetUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock workspace member: %w", err)
	}
	if targetUserID == current.UserID {
		return nil, ErrCannotUpdateSelf
	}
	if role == 5 {
		if _, err = tx.Exec(ctx, `UPDATE project_members SET role=5, updated_at=NOW(), updated_by_id=$3
			WHERE workspace_id::text=$1 AND member_id::text=$2 AND deleted_at IS NULL`, current.WorkspaceID, targetUserID, current.UserID); err != nil {
			return nil, fmt.Errorf("downgrade project memberships: %w", err)
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE workspace_members SET role=$3, updated_at=NOW(), updated_by_id=$4
		WHERE workspace_id::text=$1 AND id::text=$2`, current.WorkspaceID, memberID, role, current.UserID); err != nil {
		return nil, fmt.Errorf("update workspace member role: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit workspace member role: %w", err)
	}
	return s.retrieve(ctx, current, memberID)
}

func (s PostgreSQLStore) Remove(ctx context.Context, sessionKey, slug, memberID string) error {
	current, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	if current.Role != 20 {
		return ErrForbidden
	}
	return s.deactivate(ctx, current, memberID, false)
}

func (s PostgreSQLStore) Leave(ctx context.Context, sessionKey, slug string) error {
	current, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	if current.Role == 20 {
		var admins int
		if err = s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM workspace_members WHERE workspace_id::text=$1
			AND role=20 AND is_active=TRUE AND deleted_at IS NULL`, current.WorkspaceID).Scan(&admins); err != nil {
			return fmt.Errorf("count workspace admins: %w", err)
		}
		if admins <= 1 {
			return ErrOnlyWorkspaceAdmin
		}
	}
	return s.deactivate(ctx, current, current.MemberID, true)
}

func (s PostgreSQLStore) deactivate(ctx context.Context, current session, memberID string, leaving bool) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin workspace member removal: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var targetUserID string
	var targetRole int16
	err = tx.QueryRow(ctx, `SELECT wm.member_id::text, wm.role FROM workspace_members wm JOIN users u ON u.id=wm.member_id
		WHERE wm.workspace_id::text=$1 AND wm.id::text=$2 AND wm.is_active=TRUE
		AND wm.deleted_at IS NULL AND u.is_bot=FALSE FOR UPDATE`, current.WorkspaceID, memberID).Scan(&targetUserID, &targetRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("lock removed workspace member: %w", err)
	}
	if !leaving && memberID == current.MemberID {
		return ErrCannotRemoveSelf
	}
	if !leaving && current.Role < targetRole {
		return ErrHigherRole
	}
	var onlyAdmin bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM project_members target
		WHERE target.workspace_id::text=$1 AND target.member_id::text=$2 AND target.role=20
			AND target.is_active=TRUE AND target.deleted_at IS NULL
			AND NOT EXISTS (SELECT 1 FROM project_members other WHERE other.project_id=target.project_id
				AND other.member_id<>target.member_id AND other.role=20 AND other.is_active=TRUE AND other.deleted_at IS NULL)
	)`, current.WorkspaceID, targetUserID).Scan(&onlyAdmin)
	if err != nil {
		return fmt.Errorf("check only project admin: %w", err)
	}
	if onlyAdmin {
		if leaving {
			return ErrLeavingOnlyProjectAdmin
		}
		return ErrOnlyProjectAdmin
	}
	if _, err = tx.Exec(ctx, `UPDATE project_members SET is_active=FALSE, updated_at=NOW(), updated_by_id=$3
		WHERE workspace_id::text=$1 AND member_id::text=$2 AND is_active=TRUE AND deleted_at IS NULL`, current.WorkspaceID, targetUserID, current.UserID); err != nil {
		return fmt.Errorf("deactivate project members: %w", err)
	}
	if _, err = tx.Exec(ctx, `UPDATE workspace_members SET is_active=FALSE, updated_at=NOW(), updated_by_id=$3
		WHERE workspace_id::text=$1 AND id::text=$2`, current.WorkspaceID, memberID, current.UserID); err != nil {
		return fmt.Errorf("deactivate workspace member: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit deactivate member: %w", err)
	}
	return nil
}

func (s PostgreSQLStore) UpdateViewProps(ctx context.Context, sessionKey, slug string, viewProps map[string]any) error {
	current, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `UPDATE workspace_members SET view_props=$1, updated_at=NOW(), updated_by_id=$2
		WHERE workspace_id::text=$3 AND member_id::text=$2 AND is_active=TRUE AND deleted_at IS NULL`, viewProps, current.UserID, current.WorkspaceID)
	if err != nil {
		return fmt.Errorf("update view props: %w", err)
	}
	return nil
}

const memberQuery = `SELECT wm.id::text, wm.role,
	u.id::text, u.first_name, u.last_name, u.avatar, u.avatar_asset_id::text,
	u.is_bot, u.display_name, u.metanode_wallet_address, COALESCE(u.email,''), u.last_login_medium
	FROM workspace_members wm JOIN users u ON u.id=wm.member_id`

type rowScanner interface{ Scan(...any) error }

func scanMember(row rowScanner, adminView bool) (map[string]any, error) {
	var memberID, userID, firstName, lastName, displayName, email, lastLoginMedium string
	var role int16
	var avatar, avatarAsset, wallet *string
	var isBot bool
	if err := row.Scan(&memberID, &role, &userID, &firstName, &lastName, &avatar, &avatarAsset,
		&isBot, &displayName, &wallet, &email, &lastLoginMedium); err != nil {
		return nil, err
	}
	avatarURL := any(avatar)
	if avatarAsset != nil && *avatarAsset != "" {
		avatarURL = "/api/assets/v2/static/" + *avatarAsset + "/"
	}
	member := map[string]any{"id": userID, "first_name": firstName, "last_name": lastName,
		"avatar": avatar, "avatar_url": avatarURL, "is_bot": isBot, "display_name": displayName}
	if adminView {
		member["email"] = email
		member["last_login_medium"] = lastLoginMedium
	} else {
		member["metanode_wallet_address"] = wallet
	}
	return map[string]any{"id": memberID, "member": member, "role": role}, nil
}
