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
