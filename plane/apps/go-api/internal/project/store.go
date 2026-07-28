package project

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
	ErrNotFound     = errors.New("project not found")
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

type access struct {
	userID      string
	workspaceID string
	role        int
}

func (s PostgreSQLStore) resolveAccess(ctx context.Context, sessionKey, slug string) (access, error) {
	if s.Pool == nil {
		return access{}, errors.New("project database unavailable")
	}
	if sessionKey == "" {
		return access{}, ErrUnauthorized
	}
	var result access
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, wm.role
		FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id = w.id
			AND wm.member_id::text = s.user_id AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`, sessionKey, slug).
		Scan(&result.userID, &result.workspaceID, &result.role)
	if errors.Is(err, pgx.ErrNoRows) {
		var validSession bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM sessions WHERE session_key = $1 AND expire_date > NOW()
		)`, sessionKey).Scan(&validSession); checkErr != nil {
			return access{}, fmt.Errorf("check project session: %w", checkErr)
		}
		if validSession {
			return access{}, ErrForbidden
		}
		return access{}, ErrUnauthorized
	}
	if err != nil {
		return access{}, fmt.Errorf("resolve project access: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string, detailed bool, fields []string) ([]map[string]any, error) {
	a, err := s.resolveAccess(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, projectQuery+`
		WHERE p.workspace_id::text = $1 AND p.deleted_at IS NULL
		AND ($3 = 20 OR ($3 = 15 AND (member.role IS NOT NULL OR p.network = 2)) OR ($3 = 5 AND member.role IS NOT NULL))
		ORDER BY property.sort_order NULLS LAST, p.name`, a.workspaceID, a.userID, a.role)
	if err != nil {
		return nil, fmt.Errorf("list projects: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		item, scanErr := scanProject(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		if !detailed {
			item = liteProject(item)
		} else if len(fields) != 0 {
			item = selectFields(item, fields)
		}
		result = append(result, item)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate projects: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID string) (map[string]any, error) {
	a, err := s.resolveAccess(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	row := s.Pool.QueryRow(ctx, getProjectByIDQuery, a.workspaceID, a.userID, projectID)
	item, err := scanProject(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	network, _ := numberAsInt(item["network"])
	if !canAccessProject(a.role, item["member_role"] != nil, network) {
		return nil, ErrNotFound
	}
	return item, nil
}

// canAccessProject mirrors the visibility rules used by ListForSession.
// Workspace admins can open every project, workspace members can also open
// public projects, and guests need an explicit project membership.
func canAccessProject(workspaceRole int, hasProjectMembership bool, network int) bool {
	return workspaceRole == 20 ||
		(workspaceRole == 15 && (hasProjectMembership || network == 2)) ||
		(workspaceRole == 5 && hasProjectMembership)
}

const projectQuery = `SELECT to_jsonb(p), member.role, property.sort_order,
	EXISTS(SELECT 1 FROM user_favorites uf WHERE uf.user_id::text = $2 AND uf.project_id = p.id
		AND uf.entity_type = 'project' AND uf.deleted_at IS NULL),
	(SELECT db.anchor FROM deploy_boards db WHERE db.entity_name = 'project'
		AND db.entity_identifier = p.id AND db.deleted_at IS NULL LIMIT 1),
	COALESCE((SELECT jsonb_agg(pm.member_id::text ORDER BY pm.created_at) FROM project_members pm
		JOIN users u ON u.id = pm.member_id WHERE pm.project_id = p.id AND pm.is_active = TRUE
		AND pm.deleted_at IS NULL AND u.is_bot = FALSE), '[]'::jsonb),
	COALESCE((SELECT MAX(sequence) + 1 FROM issue_sequences seq WHERE seq.project_id = p.id), 1),
	(SELECT COUNT(*)::int FROM intake_issues ii WHERE ii.project_id = p.id AND ii.status = -2 AND ii.deleted_at IS NULL)
	FROM projects p
	LEFT JOIN LATERAL (SELECT pm.role FROM project_members pm WHERE pm.project_id = p.id
		AND pm.member_id::text = $2 AND pm.is_active = TRUE AND pm.deleted_at IS NULL LIMIT 1) member ON TRUE
	LEFT JOIN LATERAL (SELECT pup.sort_order FROM project_user_properties pup WHERE pup.project_id = p.id
		AND pup.user_id::text = $2 AND pup.deleted_at IS NULL LIMIT 1) property ON TRUE `

const getProjectByIDQuery = projectQuery + `
	WHERE p.workspace_id::text = $1 AND p.id::text = $3 AND p.deleted_at IS NULL AND p.archived_at IS NULL`

type rowScanner interface {
	Scan(...any) error
}

func scanProject(row rowScanner) (map[string]any, error) {
	var rawProject, rawMembers []byte
	var memberRole *int64
	var sortOrder *float64
	var favorite bool
	var anchor *string
	var nextSequence, intakeCount int64
	if err := row.Scan(&rawProject, &memberRole, &sortOrder, &favorite, &anchor, &rawMembers, &nextSequence, &intakeCount); err != nil {
		return nil, err
	}
	item := make(map[string]any)
	if err := json.Unmarshal(rawProject, &item); err != nil {
		return nil, fmt.Errorf("decode project: %w", err)
	}
	var members []string
	if err := json.Unmarshal(rawMembers, &members); err != nil {
		return nil, fmt.Errorf("decode project members: %w", err)
	}
	relationFields := []string{"workspace", "created_by", "updated_by", "default_assignee", "project_lead", "estimate", "default_state", "cover_image_asset"}
	for _, field := range relationFields {
		item[field] = item[field+"_id"]
		delete(item, field+"_id")
	}
	item["inbox_view"] = item["intake_view"]
	if memberRole == nil {
		item["member_role"] = nil
	} else {
		item["member_role"] = *memberRole
	}
	item["sort_order"] = sortOrder
	item["is_favorite"] = favorite
	item["anchor"] = anchor
	item["members"] = members
	item["next_work_item_sequence"] = nextSequence
	item["intake_count"] = intakeCount
	item["cover_image_url"] = item["cover_image"]
	if asset, ok := item["cover_image_asset"].(string); ok && asset != "" {
		item["cover_image_url"] = "/api/assets/v2/static/" + asset + "/"
	}
	return item, nil
}

func liteProject(item map[string]any) map[string]any {
	fields := []string{"id", "name", "identifier", "sort_order", "logo_props", "member_role", "intake_count",
		"archived_at", "workspace", "cycle_view", "issue_views_view", "module_view", "page_view", "inbox_view",
		"is_issue_type_enabled", "guest_view_all_features", "project_lead", "network", "created_at", "updated_at",
		"created_by", "updated_by"}
	return selectFields(item, fields)
}

func selectFields(item map[string]any, fields []string) map[string]any {
	selected := make(map[string]any, len(fields))
	for _, field := range fields {
		if value, exists := item[field]; exists {
			selected[field] = value
		}
	}
	return selected
}

func numberAsInt(value any) (int, bool) {
	switch n := value.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	default:
		return 0, false
	}
}
