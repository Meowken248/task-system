package workspacecontext

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
	ErrUnauthorized   = errors.New("authentication required")
	ErrForbidden      = errors.New("workspace access denied")
	ErrNotFound       = errors.New("workspace object not found")
	ErrInvalidPayload = errors.New("invalid payload")
)

var sidebarKeys = []string{"views", "active_cycles", "analytics", "drafts", "your_work", "archives", "stickies"}

type Preference struct {
	IsPinned  bool    `json:"is_pinned"`
	SortOrder float64 `json:"sort_order"`
}

type PreferencePatch struct {
	Key       string   `json:"key,omitempty"`
	IsPinned  *bool    `json:"is_pinned,omitempty"`
	SortOrder *float64 `json:"sort_order,omitempty"`
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

type workspaceSession struct {
	UserID      string
	WorkspaceID string
	Role        int16
}

func (s PostgreSQLStore) resolve(ctx context.Context, sessionKey, slug string) (workspaceSession, error) {
	if s.Pool == nil {
		return workspaceSession{}, errors.New("workspace context database unavailable")
	}
	if sessionKey == "" {
		return workspaceSession{}, ErrUnauthorized
	}
	var result workspaceSession
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, wm.role
		FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.member_id::text = s.user_id
			AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`, sessionKey, slug).
		Scan(&result.UserID, &result.WorkspaceID, &result.Role)
	if err == nil {
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return workspaceSession{}, fmt.Errorf("resolve workspace session: %w", err)
	}
	var valid bool
	if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key = $1 AND expire_date > NOW())`, sessionKey).Scan(&valid); err != nil {
		return workspaceSession{}, fmt.Errorf("check workspace session: %w", err)
	}
	if !valid {
		return workspaceSession{}, ErrUnauthorized
	}
	return workspaceSession{}, ErrForbidden
}

func (s PostgreSQLStore) CurrentMember(ctx context.Context, sessionKey, slug string) (map[string]any, error) {
	session, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	var id, member, workspace string
	var role int16
	var companyRole *string
	var viewProps, defaultProps, issueProps, checklist, tips, explored []byte
	var isActive bool
	var createdAt, updatedAt any
	var createdBy, updatedBy *string
	var draftCount int
	err = s.Pool.QueryRow(ctx, `SELECT wm.id::text, wm.member_id::text, wm.workspace_id::text, wm.role,
		wm.company_role, wm.view_props, wm.default_props, wm.issue_props, wm.is_active,
		wm.getting_started_checklist, wm.tips, wm.explored_features,
		wm.created_at, wm.updated_at, wm.created_by_id::text, wm.updated_by_id::text,
		(SELECT COUNT(*) FROM draft_issues di WHERE di.workspace_id = wm.workspace_id
			AND di.created_by_id = wm.member_id AND di.deleted_at IS NULL)
		FROM workspace_members wm WHERE wm.workspace_id::text = $1 AND wm.member_id::text = $2
			AND wm.is_active = TRUE AND wm.deleted_at IS NULL`, session.WorkspaceID, session.UserID).
		Scan(&id, &member, &workspace, &role, &companyRole, &viewProps, &defaultProps, &issueProps,
			&isActive, &checklist, &tips, &explored, &createdAt, &updatedAt, &createdBy, &updatedBy, &draftCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get current workspace member: %w", err)
	}
	return map[string]any{
		"id": id, "member": member, "workspace": workspace, "role": role,
		"company_role": companyRole, "view_props": decodeObject(viewProps), "default_props": decodeObject(defaultProps),
		"issue_props": decodeObject(issueProps), "is_active": isActive,
		"getting_started_checklist": decodeObject(checklist), "tips": decodeObject(tips), "explored_features": decodeObject(explored),
		"created_at": createdAt, "updated_at": updatedAt, "created_by": createdBy, "updated_by": updatedBy,
		"draft_issue_count": draftCount,
	}, nil
}

func (s PostgreSQLStore) RecentVisits(ctx context.Context, sessionKey, slug, entityName string) ([]map[string]any, error) {
	session, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	entityName = strings.ToLower(strings.TrimSpace(entityName))
	if entityName != "" && entityName != "issue" && entityName != "page" && entityName != "project" {
		return []map[string]any{}, nil
	}
	rows, err := s.Pool.Query(ctx, `SELECT id::text, entity_name, entity_identifier::text, visited_at
		FROM user_recent_visits WHERE workspace_id::text = $1 AND user_id::text = $2
			AND deleted_at IS NULL AND entity_name IN ('issue', 'page', 'project')
			AND ($3 = '' OR entity_name = $3)
		ORDER BY created_at DESC LIMIT 20`, session.WorkspaceID, session.UserID, entityName)
	if err != nil {
		return nil, fmt.Errorf("list recent visits: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, name string
		var identifier *string
		var visitedAt any
		if err = rows.Scan(&id, &name, &identifier, &visitedAt); err != nil {
			return nil, fmt.Errorf("scan recent visit: %w", err)
		}
		var entityData any
		if identifier != nil {
			entityData, err = s.entityData(ctx, name, *identifier)
			if err != nil {
				return nil, err
			}
		}
		result = append(result, map[string]any{"id": id, "entity_name": name, "entity_identifier": identifier, "entity_data": entityData, "visited_at": visitedAt})
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recent visits: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) entityData(ctx context.Context, entityName, id string) (any, error) {
	table := map[string]string{"issue": "issues", "page": "pages", "project": "projects"}[entityName]
	if table == "" {
		return nil, nil
	}
	var raw []byte
	query := fmt.Sprintf(`SELECT to_jsonb(entity) FROM %s entity WHERE id::text = $1 AND deleted_at IS NULL`, table)
	err := s.Pool.QueryRow(ctx, query, id).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get recent visit entity: %w", err)
	}
	var value any
	if err = json.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("decode recent visit entity: %w", err)
	}
	return value, nil
}

func (s PostgreSQLStore) SidebarPreferences(ctx context.Context, sessionKey, slug string) (map[string]Preference, error) {
	session, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin sidebar preferences: %w", err)
	}
	defer tx.Rollback(ctx)
	for i, key := range sidebarKeys {
		pinned := key == "drafts" || key == "your_work" || key == "stickies"
		_, err = tx.Exec(ctx, `INSERT INTO workspace_user_preferences
			(id, workspace_id, user_id, key, is_pinned, sort_order, created_at, updated_at, created_by_id)
			VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), $3)
			ON CONFLICT (workspace_id, user_id, key) WHERE deleted_at IS NULL DO NOTHING`,
			newUUID(), session.WorkspaceID, session.UserID, key, pinned, float64(65535+i*10000))
		if err != nil {
			return nil, fmt.Errorf("ensure sidebar preference: %w", err)
		}
	}
	rows, err := tx.Query(ctx, `SELECT key, is_pinned, sort_order FROM workspace_user_preferences
		WHERE workspace_id::text = $1 AND user_id::text = $2 AND deleted_at IS NULL ORDER BY sort_order`, session.WorkspaceID, session.UserID)
	if err != nil {
		return nil, fmt.Errorf("list sidebar preferences: %w", err)
	}
	defer rows.Close()
	result := make(map[string]Preference, len(sidebarKeys))
	for rows.Next() {
		var key string
		var item Preference
		if err = rows.Scan(&key, &item.IsPinned, &item.SortOrder); err != nil {
			return nil, fmt.Errorf("scan sidebar preference: %w", err)
		}
		result[key] = item
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sidebar preferences: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit sidebar preferences: %w", err)
	}
	return result, nil
}

func (s PostgreSQLStore) PatchSidebarPreferences(ctx context.Context, sessionKey, slug string, patches []PreferencePatch) error {
	session, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	if len(patches) == 0 {
		return ErrInvalidPayload
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin sidebar preference update: %w", err)
	}
	defer tx.Rollback(ctx)
	for _, patch := range patches {
		if !validSidebarKey(patch.Key) || (patch.IsPinned == nil && patch.SortOrder == nil) {
			return ErrInvalidPayload
		}
		command, err := tx.Exec(ctx, `UPDATE workspace_user_preferences SET
			is_pinned = COALESCE($4, is_pinned), sort_order = COALESCE($5, sort_order),
			updated_at = NOW(), updated_by_id = $2
			WHERE workspace_id::text = $1 AND user_id::text = $2 AND key = $3 AND deleted_at IS NULL`,
			session.WorkspaceID, session.UserID, patch.Key, patch.IsPinned, patch.SortOrder)
		if err != nil {
			return fmt.Errorf("update sidebar preference: %w", err)
		}
		if command.RowsAffected() == 0 {
			return ErrNotFound
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit sidebar preference update: %w", err)
	}
	return nil
}

func (s PostgreSQLStore) UserProperties(ctx context.Context, sessionKey, slug string) (map[string]any, error) {
	session, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	if err = s.ensureUserProperties(ctx, session); err != nil {
		return nil, err
	}
	return s.readUserProperties(ctx, session)
}

func (s PostgreSQLStore) PatchUserProperties(ctx context.Context, sessionKey, slug string, patch map[string]any) (map[string]any, error) {
	session, err := s.resolve(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	if err = s.ensureUserProperties(ctx, session); err != nil {
		return nil, err
	}
	allowed := map[string]bool{"filters": true, "display_filters": true, "display_properties": true, "rich_filters": true, "navigation_project_limit": true, "navigation_control_preference": true}
	for key := range patch {
		if !allowed[key] {
			return nil, ErrInvalidPayload
		}
	}
	if preference, ok := patch["navigation_control_preference"]; ok && preference != "ACCORDION" && preference != "TABBED" {
		return nil, ErrInvalidPayload
	}
	jsonValue := func(key string) any {
		value, ok := patch[key]
		if !ok {
			return nil
		}
		encoded, _ := json.Marshal(value)
		return encoded
	}
	_, err = s.Pool.Exec(ctx, `UPDATE workspace_user_properties SET
		filters = COALESCE($3::jsonb, filters), display_filters = COALESCE($4::jsonb, display_filters),
		display_properties = COALESCE($5::jsonb, display_properties), rich_filters = COALESCE($6::jsonb, rich_filters),
		navigation_project_limit = COALESCE($7::integer, navigation_project_limit),
		navigation_control_preference = COALESCE($8::text, navigation_control_preference),
		updated_at = NOW(), updated_by_id = $2
		WHERE workspace_id::text = $1 AND user_id::text = $2 AND deleted_at IS NULL`,
		session.WorkspaceID, session.UserID, jsonValue("filters"), jsonValue("display_filters"),
		jsonValue("display_properties"), jsonValue("rich_filters"), patch["navigation_project_limit"], patch["navigation_control_preference"])
	if err != nil {
		return nil, fmt.Errorf("update workspace user properties: %w", err)
	}
	return s.readUserProperties(ctx, session)
}

func (s PostgreSQLStore) ensureUserProperties(ctx context.Context, session workspaceSession) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO workspace_user_properties
		(id, workspace_id, user_id, filters, display_filters, display_properties, rich_filters,
		 navigation_project_limit, navigation_control_preference, created_at, updated_at, created_by_id)
		VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, '{}'::jsonb, 10, 'ACCORDION', NOW(), NOW(), $3)
		ON CONFLICT (workspace_id, user_id) WHERE deleted_at IS NULL DO NOTHING`,
		newUUID(), session.WorkspaceID, session.UserID, defaultFilters, defaultDisplayFilters, defaultDisplayProperties)
	if err != nil {
		return fmt.Errorf("ensure workspace user properties: %w", err)
	}
	return nil
}

func (s PostgreSQLStore) readUserProperties(ctx context.Context, session workspaceSession) (map[string]any, error) {
	var id, workspace, user, preference string
	var filters, displayFilters, displayProperties, richFilters []byte
	var limit int
	var createdAt, updatedAt any
	var createdBy, updatedBy *string
	err := s.Pool.QueryRow(ctx, `SELECT id::text, workspace_id::text, user_id::text, filters, display_filters,
		display_properties, rich_filters, navigation_project_limit, navigation_control_preference,
		created_at, updated_at, created_by_id::text, updated_by_id::text
		FROM workspace_user_properties WHERE workspace_id::text = $1 AND user_id::text = $2 AND deleted_at IS NULL`,
		session.WorkspaceID, session.UserID).Scan(&id, &workspace, &user, &filters, &displayFilters,
		&displayProperties, &richFilters, &limit, &preference, &createdAt, &updatedAt, &createdBy, &updatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get workspace user properties: %w", err)
	}
	return map[string]any{
		"id": id, "workspace": workspace, "user": user, "filters": decodeObject(filters),
		"display_filters": decodeObject(displayFilters), "display_properties": decodeObject(displayProperties),
		"rich_filters": decodeObject(richFilters), "navigation_project_limit": limit,
		"navigation_control_preference": preference, "created_at": createdAt, "updated_at": updatedAt,
		"created_by": createdBy, "updated_by": updatedBy,
	}, nil
}

func validSidebarKey(key string) bool {
	for _, allowed := range sidebarKeys {
		if key == allowed {
			return true
		}
	}
	return false
}

func decodeObject(raw []byte) any {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return map[string]any{}
	}
	return value
}

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

const defaultFilters = `{"priority":null,"state":null,"state_group":null,"assignees":null,"created_by":null,"labels":null,"start_date":null,"target_date":null,"subscriber":null}`
const defaultDisplayFilters = `{"group_by":null,"order_by":"-created_at","type":null,"sub_issue":true,"show_empty_groups":true,"layout":"list","calendar_date_range":""}`
const defaultDisplayProperties = `{"assignee":true,"attachment_count":true,"created_on":true,"due_date":true,"estimate":true,"key":true,"labels":true,"link":true,"priority":true,"start_date":true,"state":true,"sub_issue_count":true,"updated_on":true}`
