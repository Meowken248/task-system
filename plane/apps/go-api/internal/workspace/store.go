package workspace

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

var allowedFields = map[string]struct{}{
	"id": {}, "name": {}, "logo": {}, "logo_asset": {}, "logo_url": {}, "owner": {}, "slug": {},
	"organization_size": {}, "timezone": {}, "background_color": {}, "created_at": {}, "updated_at": {},
	"created_by": {}, "updated_by": {}, "deleted_at": {}, "role": {}, "total_members": {},
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey string, fields []string) ([]map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("workspace database unavailable")
	}
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key = $1 AND expire_date > NOW()`, sessionKey).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) || userID == "" {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, fmt.Errorf("resolve workspace session: %w", err)
	}
	rows, err := s.Pool.Query(ctx, `SELECT
		w.id::text, w.name, w.logo, w.logo_asset_id::text, w.owner_id::text, w.slug,
		w.organization_size, w.timezone, w.background_color, w.created_at, w.updated_at,
		w.created_by_id::text, w.updated_by_id::text, w.deleted_at, wm.role,
		(SELECT COUNT(*)::int FROM workspace_members active_wm
		 JOIN users member_user ON member_user.id = active_wm.member_id
		 WHERE active_wm.workspace_id = w.id AND active_wm.is_active = TRUE
		 AND active_wm.deleted_at IS NULL AND member_user.is_bot = FALSE) AS total_members
	FROM workspaces w
	JOIN workspace_members wm ON wm.workspace_id = w.id
	WHERE wm.member_id::text = $1 AND wm.is_active = TRUE AND wm.deleted_at IS NULL AND w.deleted_at IS NULL
	ORDER BY w.created_at ASC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, name, slug, timezone, background string
		var logo, logoAsset, organizationSize, createdBy, updatedBy *string
		var owner string
		var createdAt, updatedAt any
		var deletedAt any
		var role, totalMembers int
		if err = rows.Scan(&id, &name, &logo, &logoAsset, &owner, &slug, &organizationSize, &timezone, &background,
			&createdAt, &updatedAt, &createdBy, &updatedBy, &deletedAt, &role, &totalMembers); err != nil {
			return nil, fmt.Errorf("scan workspace: %w", err)
		}
		item := map[string]any{
			"id": id, "name": name, "logo": logo, "logo_asset": logoAsset, "logo_url": logo,
			"owner": owner, "slug": slug, "organization_size": organizationSize, "timezone": timezone,
			"background_color": background, "created_at": createdAt, "updated_at": updatedAt,
			"created_by": createdBy, "updated_by": updatedBy, "deleted_at": deletedAt,
			"role": role, "total_members": totalMembers,
		}
		if logoAsset != nil && *logoAsset != "" {
			item["logo_url"] = "/api/assets/v2/static/" + *logoAsset + "/"
		}
		result = append(result, selectFields(item, fields))
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workspaces: %w", err)
	}
	return result, nil
}

func selectFields(item map[string]any, fields []string) map[string]any {
	if len(fields) == 0 {
		return item
	}
	selected := make(map[string]any, len(fields))
	for _, field := range fields {
		if _, allowed := allowedFields[field]; allowed {
			selected[field] = item[field]
		}
	}
	return selected
}
