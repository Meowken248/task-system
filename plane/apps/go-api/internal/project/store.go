package project

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
	ErrNotFound     = errors.New("project not found")
	ErrInvalid      = errors.New("invalid payload")
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

type ProjectPayload struct {
	Name                 string  `json:"name"`
	Identifier           string  `json:"identifier"`
	Description          *string `json:"description"`
	Network              *int    `json:"network"`
	ProjectLead          *string `json:"project_lead"`
	DefaultAssignee      *string `json:"default_assignee"`
	CycleView            *bool   `json:"cycle_view"`
	ModuleView           *bool   `json:"module_view"`
	IssueViewsView       *bool   `json:"issue_views_view"`
	PageView             *bool   `json:"page_view"`
	InboxView            *bool   `json:"inbox_view"`
	GuestViewAllFeatures *bool   `json:"guest_view_all_features"`
}

var defaultStates = []map[string]any{
	{"name": "Backlog", "color": "#60646C", "sequence": float64(15000), "group": "backlog", "default": true},
	{"name": "Todo", "color": "#60646C", "sequence": float64(25000), "group": "unstarted", "default": false},
	{"name": "In Progress", "color": "#F59E0B", "sequence": float64(35000), "group": "started", "default": false},
	{"name": "Done", "color": "#46A758", "sequence": float64(45000), "group": "completed", "default": false},
	{"name": "Cancelled", "color": "#9AA4BC", "sequence": float64(55000), "group": "cancelled", "default": false},
	{"name": "Triage", "color": "#4E5355", "sequence": float64(65000), "group": "triage", "default": false},
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug string, payload ProjectPayload) (map[string]any, error) {
	a, err := s.resolveAccess(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	if a.role < 15 { // Only Admin/Member can create project
		return nil, ErrForbidden
	}
	if payload.Name == "" || payload.Identifier == "" {
		return nil, fmt.Errorf("%w: name and identifier are required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Check identifier uniqueness in workspace
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE workspace_id::text=$1 AND identifier=$2 AND deleted_at IS NULL)`,
		a.workspaceID, payload.Identifier).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, fmt.Errorf("%w: project identifier already exists", ErrInvalid)
	}

	projectID := newUUID()
	network := 2 // default public
	if payload.Network != nil {
		network = *payload.Network
	}

	cycleView := true
	if payload.CycleView != nil {
		cycleView = *payload.CycleView
	}
	moduleView := true
	if payload.ModuleView != nil {
		moduleView = *payload.ModuleView
	}
	issueViewsView := true
	if payload.IssueViewsView != nil {
		issueViewsView = *payload.IssueViewsView
	}
	pageView := true
	if payload.PageView != nil {
		pageView = *payload.PageView
	}
	inboxView := true
	if payload.InboxView != nil {
		inboxView = *payload.InboxView
	}
	guestViewAll := false
	if payload.GuestViewAllFeatures != nil {
		guestViewAll = *payload.GuestViewAllFeatures
	}
	description := ""
	if payload.Description != nil {
		description = *payload.Description
	}

	_, err = tx.Exec(ctx, `INSERT INTO projects
		(id, name, identifier, description, network, workspace_id,
		 cycle_view, module_view, issue_views_view, page_view, intake_view, guest_view_all_features,
		 project_lead_id, default_assignee_id,
		 archive_in, close_in, logo_props, is_time_tracking_enabled, is_issue_type_enabled, timezone,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6::uuid,
			$7,$8,$9,$10,$11,$12,
			NULLIF($13,'')::uuid, NULLIF($14,'')::uuid,
			0, 0, '{}'::jsonb, FALSE, FALSE, 'UTC',
			$15::uuid,$15::uuid,NOW(),NOW())`,
		projectID, payload.Name, payload.Identifier, description, network, a.workspaceID,
		cycleView, moduleView, issueViewsView, pageView, inboxView, guestViewAll,
		stringValue(payload.ProjectLead), stringValue(payload.DefaultAssignee), a.userID)
	if err != nil {
		return nil, err
	}

	// Add creator as Administrator
	_, err = tx.Exec(ctx, `INSERT INTO project_members
		(id, project_id, member_id, role, workspace_id, is_active,
		 view_props, default_props, preferences, sort_order,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,$3::uuid,20,$4::uuid,TRUE,
			'{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 65535,
			$3::uuid,$3::uuid,NOW(),NOW())`,
		newUUID(), projectID, a.userID, a.workspaceID)
	if err != nil {
		return nil, err
	}

	// If lead is different from creator, add lead as Administrator
	if payload.ProjectLead != nil && *payload.ProjectLead != "" && *payload.ProjectLead != a.userID {
		_, err = tx.Exec(ctx, `INSERT INTO project_members
			(id, project_id, member_id, role, workspace_id, is_active,
			 view_props, default_props, preferences, sort_order,
			 created_by_id, updated_by_id, created_at, updated_at)
			VALUES ($1,$2::uuid,$3::uuid,20,$4::uuid,TRUE,
				'{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 65535,
				$5::uuid,$5::uuid,NOW(),NOW())`,
			newUUID(), projectID, *payload.ProjectLead, a.workspaceID, a.userID)
		if err != nil {
			return nil, err
		}
	}

	// Bulk create DEFAULT_STATES
	for _, state := range defaultStates {
		stateName := state["name"].(string)
		stateSlug := strings.ToLower(strings.ReplaceAll(stateName, " ", "-"))
		isTriage := state["group"] == "triage"
		_, err = tx.Exec(ctx, `INSERT INTO states
			(id, name, description, slug, color, sequence, "group", "default", is_triage, project_id, workspace_id,
			 created_by_id, updated_by_id, created_at, updated_at)
			VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9::uuid,$10::uuid,$11::uuid,$11::uuid,NOW(),NOW())`,
			newUUID(), stateName, stateSlug, state["color"], state["sequence"], state["group"], state["default"], isTriage,
			projectID, a.workspaceID, a.userID)
		if err != nil {
			return nil, err
		}
	}

	// Get and return project details
	row := tx.QueryRow(ctx, getProjectByIDQuery, a.workspaceID, a.userID, projectID)
	item, err := scanProject(row)
	if err != nil {
		return nil, err
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID string, payload map[string]any) (map[string]any, error) {
	a, err := s.resolveAccess(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Check permission (Workspace Admin (20) or Project Admin (20) required)
	var hasPerm bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM project_members WHERE project_id::text=$1 AND member_id::text=$2 AND role=20 AND is_active=TRUE AND deleted_at IS NULL
	) OR $3=20`, projectID, a.userID, a.role).Scan(&hasPerm)
	if err != nil {
		return nil, err
	}
	if !hasPerm {
		return nil, ErrForbidden
	}

	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE id::text=$1 AND workspace_id::text=$2 AND deleted_at IS NULL)`, projectID, a.workspaceID).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}

	// Update columns dynamically
	query := `UPDATE projects SET updated_at=NOW(), updated_by_id=$2 `
	args := []any{projectID, a.userID}
	placeholderIndex := 3

	// Map of allowed update fields
	allowedFields := map[string]string{
		"name":                    "name",
		"description":             "description",
		"network":                 "network",
		"cycle_view":              "cycle_view",
		"module_view":             "module_view",
		"issue_views_view":        "issue_views_view",
		"page_view":               "page_view",
		"inbox_view":              "intake_view",
		"guest_view_all_features": "guest_view_all_features",
		"project_lead":            "project_lead_id",
		"default_assignee":        "default_assignee_id",
	}

	for key, val := range payload {
		if dbCol, ok := allowedFields[key]; ok {
			query += fmt.Sprintf(", %s=$%d ", dbCol, placeholderIndex)
			if val == nil {
				args = append(args, nil)
			} else if key == "project_lead" || key == "default_assignee" {
				// Convert to uuid safely if non-empty string
				strVal := fmt.Sprintf("%v", val)
				if strVal == "" {
					args = append(args, nil)
				} else {
					args = append(args, strVal)
				}
			} else {
				args = append(args, val)
			}
			placeholderIndex++
		}
	}

	query += ` WHERE id::text=$1 AND workspace_id::text = (SELECT id FROM workspaces WHERE slug=$12 AND deleted_at IS NULL) AND deleted_at IS NULL`
	// Map workspace slug using the last positional arg (placeholder 12)
	for placeholderIndex < 12 {
		query += fmt.Sprintf(" AND 1=$%d", placeholderIndex)
		args = append(args, 1)
		placeholderIndex++
	}
	args = append(args, slug)

	_, err = tx.Exec(ctx, query, args...)
	if err != nil {
		return nil, err
	}

	row := tx.QueryRow(ctx, getProjectByIDQuery, a.workspaceID, a.userID, projectID)
	item, err := scanProject(row)
	if err != nil {
		return nil, err
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID string) error {
	a, err := s.resolveAccess(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	if a.role < 20 { // Only Workspace Administrator can delete projects
		return ErrForbidden
	}

	result, err := s.Pool.Exec(ctx, `UPDATE projects SET deleted_at=NOW(), updated_by_id=$2, updated_at=NOW()
		WHERE id::text=$1 AND workspace_id::text=$3 AND deleted_at IS NULL`, projectID, a.userID, a.workspaceID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

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

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
