package userproperty

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized   = errors.New("authentication required")
	ErrForbidden      = errors.New("project access denied")
	ErrNotFound       = errors.New("user properties target not found")
	ErrInvalidPayload = errors.New("invalid user properties payload")
)

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

type access struct {
	UserID, WorkspaceID, ProjectID string
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID string, scope Scope, entityID string) (map[string]any, error) {
	a, err := s.resolve(ctx, sessionKey, slug, projectID, scope, entityID)
	if err != nil {
		return nil, err
	}
	if err = s.ensure(ctx, a, scope, entityID); err != nil {
		return nil, err
	}
	return s.read(ctx, a, scope, entityID)
}

func (s PostgreSQLStore) PatchForSession(ctx context.Context, sessionKey, slug, projectID string, scope Scope, entityID string, patch map[string]any) (map[string]any, error) {
	a, err := s.resolve(ctx, sessionKey, slug, projectID, scope, entityID)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{"filters": true, "rich_filters": true, "display_filters": true, "display_properties": true}
	if scope == ScopeProject {
		allowed["preferences"] = true
		allowed["sort_order"] = true
	}
	if len(patch) == 0 {
		return nil, ErrInvalidPayload
	}
	for key := range patch {
		if !allowed[key] {
			return nil, ErrInvalidPayload
		}
	}
	if err = s.ensure(ctx, a, scope, entityID); err != nil {
		return nil, err
	}
	jsonValue := func(key string) any {
		value, ok := patch[key]
		if !ok {
			return nil
		}
		encoded, _ := json.Marshal(value)
		return encoded
	}
	if scope == ScopeProject {
		_, err = s.Pool.Exec(ctx, `UPDATE project_user_properties SET
			filters=COALESCE($3::jsonb,filters), rich_filters=COALESCE($4::jsonb,rich_filters),
			display_filters=COALESCE($5::jsonb,display_filters), display_properties=COALESCE($6::jsonb,display_properties),
			preferences=COALESCE($7::jsonb,preferences), sort_order=COALESCE($8::double precision,sort_order),
			updated_at=NOW(), updated_by_id=$2
			WHERE project_id::text=$1 AND user_id::text=$2 AND deleted_at IS NULL`,
			a.ProjectID, a.UserID, jsonValue("filters"), jsonValue("rich_filters"), jsonValue("display_filters"),
			jsonValue("display_properties"), jsonValue("preferences"), patch["sort_order"])
	} else {
		table, entityColumn := scopeTable(scope)
		query := fmt.Sprintf(`UPDATE %s SET filters=COALESCE($4::jsonb,filters), rich_filters=COALESCE($5::jsonb,rich_filters),
			display_filters=COALESCE($6::jsonb,display_filters), display_properties=COALESCE($7::jsonb,display_properties),
			updated_at=NOW(), updated_by_id=$3 WHERE %s::text=$1 AND project_id::text=$2 AND user_id::text=$3 AND deleted_at IS NULL`, table, entityColumn)
		_, err = s.Pool.Exec(ctx, query, entityID, a.ProjectID, a.UserID, jsonValue("filters"), jsonValue("rich_filters"), jsonValue("display_filters"), jsonValue("display_properties"))
	}
	if err != nil {
		return nil, fmt.Errorf("patch %s user properties: %w", scope, err)
	}
	return s.read(ctx, a, scope, entityID)
}

func (s PostgreSQLStore) resolve(ctx context.Context, sessionKey, slug, projectID string, scope Scope, entityID string) (access, error) {
	if s.Pool == nil {
		return access{}, errors.New("user properties database unavailable")
	}
	if sessionKey == "" {
		return access{}, ErrUnauthorized
	}
	if scope != ScopeProject && scope != ScopeCycle && scope != ScopeModule {
		return access{}, ErrNotFound
	}
	var a access
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, p.id::text
		FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug, projectID).Scan(&a.UserID, &a.WorkspaceID, &a.ProjectID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return access{}, fmt.Errorf("resolve user properties access: %w", err)
		}
		var valid bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); checkErr != nil {
			return access{}, fmt.Errorf("check user properties session: %w", checkErr)
		}
		if !valid {
			return access{}, ErrUnauthorized
		}
		return access{}, ErrForbidden
	}
	if scope != ScopeProject {
		var exists bool
		var query string
		if scope == ScopeCycle {
			query = `SELECT EXISTS(SELECT 1 FROM cycles WHERE id::text=$1 AND project_id::text=$2 AND workspace_id::text=$3 AND deleted_at IS NULL)`
		} else {
			query = `SELECT EXISTS(SELECT 1 FROM modules WHERE id::text=$1 AND project_id::text=$2 AND workspace_id::text=$3 AND deleted_at IS NULL)`
		}
		if err = s.Pool.QueryRow(ctx, query, entityID, a.ProjectID, a.WorkspaceID).Scan(&exists); err != nil {
			return access{}, fmt.Errorf("resolve %s user properties target: %w", scope, err)
		}
		if !exists {
			return access{}, ErrNotFound
		}
	}
	return a, nil
}

func (s PostgreSQLStore) ensure(ctx context.Context, a access, scope Scope, entityID string) error {
	if scope == ScopeProject {
		_, err := s.Pool.Exec(ctx, `INSERT INTO project_user_properties
			(id,workspace_id,project_id,user_id,filters,rich_filters,display_filters,display_properties,preferences,sort_order,created_at,updated_at,created_by_id)
			VALUES($1,$2,$3,$4,$5::jsonb,'{}'::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,65535,NOW(),NOW(),$4)
			ON CONFLICT(project_id,user_id) WHERE deleted_at IS NULL DO NOTHING`, newUUID(), a.WorkspaceID, a.ProjectID, a.UserID,
			defaultFilters, defaultDisplayFilters, defaultDisplayProperties, defaultPreferences)
		if err != nil {
			return fmt.Errorf("ensure project user properties: %w", err)
		}
		return nil
	}
	table, entityColumn := scopeTable(scope)
	query := fmt.Sprintf(`INSERT INTO %s
		(id,workspace_id,project_id,%s,user_id,filters,rich_filters,display_filters,display_properties,created_at,updated_at,created_by_id)
		VALUES($1,$2,$3,$4,$5,$6::jsonb,'{}'::jsonb,$7::jsonb,$8::jsonb,NOW(),NOW(),$5)
		ON CONFLICT(%s,user_id) WHERE deleted_at IS NULL DO NOTHING`, table, entityColumn, entityColumn)
	_, err := s.Pool.Exec(ctx, query, newUUID(), a.WorkspaceID, a.ProjectID, entityID, a.UserID, defaultFilters, defaultDisplayFilters, defaultDisplayProperties)
	if err != nil {
		return fmt.Errorf("ensure %s user properties: %w", scope, err)
	}
	return nil
}

func (s PostgreSQLStore) read(ctx context.Context, a access, scope Scope, entityID string) (map[string]any, error) {
	var id, workspace, project, user string
	var filters, richFilters, displayFilters, displayProperties []byte
	var createdAt, updatedAt time.Time
	var deletedAt *time.Time
	var createdBy, updatedBy *string
	if scope == ScopeProject {
		var preferences []byte
		var sortOrder float64
		err := s.Pool.QueryRow(ctx, `SELECT id::text,workspace_id::text,project_id::text,user_id::text,filters,rich_filters,
			display_filters,display_properties,preferences,sort_order,created_at,updated_at,deleted_at,created_by_id::text,updated_by_id::text
			FROM project_user_properties WHERE project_id::text=$1 AND user_id::text=$2 AND deleted_at IS NULL`, a.ProjectID, a.UserID).
			Scan(&id, &workspace, &project, &user, &filters, &richFilters, &displayFilters, &displayProperties, &preferences, &sortOrder,
				&createdAt, &updatedAt, &deletedAt, &createdBy, &updatedBy)
		if err != nil {
			return nil, readError(scope, err)
		}
		return propertyMap(id, workspace, project, user, filters, richFilters, displayFilters, displayProperties, createdAt, updatedAt, deletedAt, createdBy, updatedBy,
			map[string]any{"preferences": decodeJSON(preferences), "sort_order": sortOrder}), nil
	}
	table, entityColumn := scopeTable(scope)
	query := fmt.Sprintf(`SELECT id::text,workspace_id::text,project_id::text,user_id::text,filters,rich_filters,display_filters,display_properties,
		created_at,updated_at,deleted_at,created_by_id::text,updated_by_id::text FROM %s
		WHERE %s::text=$1 AND project_id::text=$2 AND user_id::text=$3 AND deleted_at IS NULL`, table, entityColumn)
	err := s.Pool.QueryRow(ctx, query, entityID, a.ProjectID, a.UserID).Scan(&id, &workspace, &project, &user, &filters, &richFilters,
		&displayFilters, &displayProperties, &createdAt, &updatedAt, &deletedAt, &createdBy, &updatedBy)
	if err != nil {
		return nil, readError(scope, err)
	}
	return propertyMap(id, workspace, project, user, filters, richFilters, displayFilters, displayProperties, createdAt, updatedAt, deletedAt, createdBy, updatedBy,
		map[string]any{string(scope): entityID}), nil
}

func propertyMap(id, workspace, project, user string, filters, richFilters, displayFilters, displayProperties []byte, createdAt, updatedAt, deletedAt any, createdBy, updatedBy *string, extra map[string]any) map[string]any {
	result := map[string]any{"id": id, "workspace": workspace, "project": project, "user": user, "filters": decodeJSON(filters),
		"rich_filters": decodeJSON(richFilters), "display_filters": decodeJSON(displayFilters), "display_properties": decodeJSON(displayProperties),
		"created_at": createdAt, "updated_at": updatedAt, "deleted_at": deletedAt, "created_by": createdBy, "updated_by": updatedBy}
	for key, value := range extra {
		result[key] = value
	}
	return result
}

func readError(scope Scope, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return fmt.Errorf("read %s user properties: %w", scope, err)
}

func scopeTable(scope Scope) (string, string) {
	if scope == ScopeCycle {
		return "cycle_user_properties", "cycle_id"
	}
	return "module_user_properties", "module_id"
}

func decodeJSON(raw []byte) any {
	var value any
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return map[string]any{}
	}
	return value
}

func newUUID() string {
	var value [16]byte
	_, _ = rand.Read(value[:])
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(value[:])
	return encoded[:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]
}

const defaultFilters = `{"priority":null,"state":null,"state_group":null,"assignees":null,"created_by":null,"labels":null,"start_date":null,"target_date":null,"subscriber":null}`
const defaultDisplayFilters = `{"group_by":null,"order_by":"-created_at","type":null,"sub_issue":true,"show_empty_groups":true,"layout":"list","calendar_date_range":""}`
const defaultDisplayProperties = `{"assignee":true,"attachment_count":true,"created_on":true,"due_date":true,"estimate":true,"key":true,"labels":true,"link":true,"priority":true,"start_date":true,"state":true,"sub_issue_count":true,"updated_on":true}`
const defaultPreferences = `{"pages":{"block_display":true},"navigation":{"default_tab":"work_items","hide_in_more_menu":[]}}`
