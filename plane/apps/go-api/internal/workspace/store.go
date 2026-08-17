package workspace

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
	ErrNotFound     = errors.New("workspace not found")
	ErrInvalid      = errors.New("invalid payload")
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

type WorkspacePayload struct {
	Name             string  `json:"name"`
	Slug             string  `json:"slug"`
	CompanyRole      *string `json:"company_role"`
	OrganizationSize *string `json:"organization_size"`
}

var allowedFields = map[string]struct{}{
	"id": {}, "name": {}, "logo": {}, "logo_asset": {}, "logo_url": {}, "owner": {}, "slug": {},
	"organization_size": {}, "timezone": {}, "background_color": {}, "created_at": {}, "updated_at": {},
	"created_by": {}, "updated_by": {}, "deleted_at": {}, "role": {}, "total_members": {},
}

func (s PostgreSQLStore) resolveUser(ctx context.Context, sessionKey string) (string, error) {
	if s.Pool == nil {
		return "", errors.New("database unavailable")
	}
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key = $1 AND expire_date > NOW()`, sessionKey).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) || userID == "" {
		return "", ErrUnauthorized
	}
	return userID, err
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey string, fields []string) ([]map[string]any, error) {
	userID, err := s.resolveUser(ctx, sessionKey)
	if err != nil {
		return nil, err
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

func (s PostgreSQLStore) Create(ctx context.Context, sessionKey string, payload WorkspacePayload) (map[string]any, error) {
	userID, err := s.resolveUser(ctx, sessionKey)
	if err != nil {
		return nil, err
	}
	if payload.Name == "" || payload.Slug == "" {
		return nil, fmt.Errorf("%w: name and slug are required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Check configuration value
	var disableWorkspaceCreation string
	_ = tx.QueryRow(ctx, `SELECT value FROM instance_configurations WHERE key='DISABLE_WORKSPACE_CREATION'`).Scan(&disableWorkspaceCreation)
	if disableWorkspaceCreation == "1" {
		return nil, fmt.Errorf("%w: workspace creation is disabled", ErrForbidden)
	}

	// Check slug uniqueness
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspaces WHERE slug=$1 AND deleted_at IS NULL)`, payload.Slug).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, fmt.Errorf("%w: workspace slug already exists", ErrInvalid)
	}

	workspaceID := newUUID()
	orgSize := "5-10"
	if payload.OrganizationSize != nil {
		orgSize = *payload.OrganizationSize
	}

	_, err = tx.Exec(ctx, `INSERT INTO workspaces
		(id, name, slug, owner_id, organization_size, timezone, background_color,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4::uuid,$5,'UTC','#000000',$4::uuid,$4::uuid,NOW(),NOW())`,
		workspaceID, payload.Name, payload.Slug, userID, orgSize)
	if err != nil {
		return nil, err
	}

	// Create Member record
	companyRole := ""
	if payload.CompanyRole != nil {
		companyRole = *payload.CompanyRole
	}
	_, err = tx.Exec(ctx, `INSERT INTO workspace_members
		(id, workspace_id, member_id, role, company_role, is_active, created_by_id, updated_by_id, created_at, updated_at,
		 view_props, default_props, issue_props, explored_features, getting_started_checklist, tips)
		VALUES ($1,$2::uuid,$3::uuid,20,$4,TRUE,$3::uuid,$3::uuid,NOW(),NOW(),
		 '{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb)`,
		newUUID(), workspaceID, userID, companyRole)
	if err != nil {
		return nil, err
	}

	// Fetch created workspace
	var id, name, slugScan, timezone, background string
	var logo, logoAsset, organizationSize, createdBy, updatedBy *string
	var owner string
	var createdAt, updatedAt any
	var deletedAt any
	var role, totalMembers int

	err = tx.QueryRow(ctx, `SELECT
		w.id::text, w.name, w.logo, w.logo_asset_id::text, w.owner_id::text, w.slug,
		w.organization_size, w.timezone, w.background_color, w.created_at, w.updated_at,
		w.created_by_id::text, w.updated_by_id::text, w.deleted_at, 20 AS role, 1 AS total_members
		FROM workspaces w
		WHERE w.id::text=$1`, workspaceID).Scan(
		&id, &name, &logo, &logoAsset, &owner, &slugScan, &organizationSize, &timezone, &background,
		&createdAt, &updatedAt, &createdBy, &updatedBy, &deletedAt, &role, &totalMembers)
	if err != nil {
		return nil, err
	}

	item := map[string]any{
		"id": id, "name": name, "logo": logo, "logo_asset": logoAsset, "logo_url": logo,
		"owner": owner, "slug": slugScan, "organization_size": organizationSize, "timezone": timezone,
		"background_color": background, "created_at": createdAt, "updated_at": updatedAt,
		"created_by": createdBy, "updated_by": updatedBy, "deleted_at": deletedAt,
		"role": role, "total_members": totalMembers,
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (s PostgreSQLStore) Update(ctx context.Context, sessionKey, slug string, payload map[string]any) (map[string]any, error) {
	userID, err := s.resolveUser(ctx, sessionKey)
	if err != nil {
		return nil, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Check Admin role on Workspace
	var role int
	err = tx.QueryRow(ctx, `SELECT role FROM workspace_members WHERE workspace_id = (SELECT id FROM workspaces WHERE slug=$1 AND deleted_at IS NULL) AND member_id::text=$2 AND is_active=TRUE AND deleted_at IS NULL`,
		slug, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if role < 20 {
		return nil, ErrForbidden
	}

	query := `UPDATE workspaces SET updated_at=NOW(), updated_by_id=$2 `
	args := []any{slug, userID}
	placeholderIndex := 3

	allowedUpdate := map[string]string{
		"name":              "name",
		"logo":              "logo",
		"logo_asset":        "logo_asset_id",
		"organization_size": "organization_size",
		"timezone":          "timezone",
		"background_color":  "background_color",
	}

	for key, val := range payload {
		if dbCol, ok := allowedUpdate[key]; ok {
			query += fmt.Sprintf(", %s=$%d ", dbCol, placeholderIndex)
			if val == nil {
				args = append(args, nil)
			} else {
				args = append(args, val)
			}
			placeholderIndex++
		}
	}

	query += ` WHERE slug=$1 AND deleted_at IS NULL`

	_, err = tx.Exec(ctx, query, args...)
	if err != nil {
		return nil, err
	}

	// Fetch updated workspace
	var id, name, updatedSlug, timezone, background string
	var logo, logoAsset, organizationSize, createdBy, updatedBy *string
	var owner string
	var createdAt, updatedAt any
	var deletedAt any
	var totalMembers int

	err = tx.QueryRow(ctx, `SELECT
		w.id::text, w.name, w.logo, w.logo_asset_id::text, w.owner_id::text, w.slug,
		w.organization_size, w.timezone, w.background_color, w.created_at, w.updated_at,
		w.created_by_id::text, w.updated_by_id::text, w.deleted_at,
		(SELECT COUNT(*)::int FROM workspace_members active_wm JOIN users u ON u.id=active_wm.member_id WHERE active_wm.workspace_id=w.id AND active_wm.is_active=TRUE AND active_wm.deleted_at IS NULL AND u.is_bot=FALSE) AS total_members
		FROM workspaces w
		WHERE w.slug=$1 AND w.deleted_at IS NULL`, slug).Scan(
		&id, &name, &logo, &logoAsset, &owner, &updatedSlug, &organizationSize, &timezone, &background,
		&createdAt, &updatedAt, &createdBy, &updatedBy, &deletedAt, &totalMembers)
	if err != nil {
		return nil, err
	}

	item := map[string]any{
		"id": id, "name": name, "logo": logo, "logo_asset": logoAsset, "logo_url": logo,
		"owner": owner, "slug": updatedSlug, "organization_size": organizationSize, "timezone": timezone,
		"background_color": background, "created_at": createdAt, "updated_at": updatedAt,
		"created_by": createdBy, "updated_by": updatedBy, "deleted_at": deletedAt,
		"role": role, "total_members": totalMembers,
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return item, nil
}

func (s PostgreSQLStore) Delete(ctx context.Context, sessionKey, slug string) error {
	userID, err := s.resolveUser(ctx, sessionKey)
	if err != nil {
		return err
	}

	var role int
	err = s.Pool.QueryRow(ctx, `SELECT role FROM workspace_members WHERE workspace_id = (SELECT id FROM workspaces WHERE slug=$1 AND deleted_at IS NULL) AND member_id::text=$2 AND is_active=TRUE AND deleted_at IS NULL`,
		slug, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if role < 20 {
		return ErrForbidden
	}

	result, err := s.Pool.Exec(ctx, `UPDATE workspaces SET deleted_at=NOW(), updated_by_id=$2, updated_at=NOW() WHERE slug=$1 AND deleted_at IS NULL`, slug, userID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
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

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}
