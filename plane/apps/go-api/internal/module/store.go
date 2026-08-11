package module

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
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("module not found")
	ErrInvalid      = errors.New("invalid payload")
)

type ModuleItem struct {
	ID              string          `json:"id"`
	WorkspaceID     string          `json:"workspace"`
	ProjectID       string          `json:"project"`
	Name            string          `json:"name"`
	Description     string          `json:"description"`
	StartDate       *time.Time      `json:"start_date"`
	TargetDate      *time.Time      `json:"target_date"`
	Status          string          `json:"status"`
	Lead            *string         `json:"lead"`
	ViewProps       json.RawMessage `json:"view_props"`
	SortOrder       float64         `json:"sort_order"`
	LogoProps       json.RawMessage `json:"logo_props"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
	CreatedBy       string          `json:"created_by"`
	UpdatedBy       string          `json:"updated_by"`
	IsFavorite      bool            `json:"is_favorite"`
	TotalIssues     int             `json:"total_issues"`
	CompletedIssues int             `json:"completed_issues"`
}

type WritePayload struct {
	Name        *string         `json:"name"`
	Description *string         `json:"description"`
	StartDate   *time.Time      `json:"start_date"`
	TargetDate  *time.Time      `json:"target_date"`
	Status      *string         `json:"status"`
	Lead        *string         `json:"lead"`
	ViewProps   json.RawMessage `json:"view_props"`
	SortOrder   *float64        `json:"sort_order"`
	LogoProps   json.RawMessage `json:"logo_props"`
	present     map[string]bool
}

func (p *WritePayload) UnmarshalJSON(data []byte) error {
	type plain WritePayload
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*p = WritePayload(decoded)
	p.present = make(map[string]bool, len(fields))
	for field := range fields {
		p.present[field] = true
	}
	return nil
}

func (p WritePayload) has(field string) bool { return p.present[field] }

type writeIdentity struct {
	UserID      string
	WorkspaceID string
	ProjectID   string
	Role        int
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) writeIdentity(ctx context.Context, sessionKey, slug, projectID string) (writeIdentity, error) {
	if s.Pool == nil {
		return writeIdentity{}, errors.New("database unavailable")
	}
	if sessionKey == "" {
		return writeIdentity{}, ErrUnauthorized
	}
	var identity writeIdentity
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, pm.role
		FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN project_members pm ON pm.project_id::text=$3 AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug, projectID).Scan(&identity.UserID, &identity.WorkspaceID, &identity.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return writeIdentity{}, ErrForbidden
	}
	identity.ProjectID = projectID
	return identity, err
}

const moduleColumns = `m.id::text, m.workspace_id::text, m.project_id::text, m.name, m.description,
	m.start_date, m.target_date, m.status, m.lead_id::text, m.view_props, m.sort_order, m.logo_props,
	m.created_at, m.updated_at, m.created_by_id::text, m.updated_by_id::text,
	EXISTS(SELECT 1 FROM user_favorites f WHERE f.entity_type='module' AND f.entity_identifier::text=m.id::text AND f.user_id::text=$1 AND f.deleted_at IS NULL) AS is_favorite,
	(SELECT COUNT(mi.issue_id)::int FROM module_issues mi JOIN issues i ON i.id=mi.issue_id WHERE mi.module_id=m.id AND mi.deleted_at IS NULL AND i.deleted_at IS NULL) AS total_issues,
	(SELECT COUNT(mi.issue_id)::int FROM module_issues mi JOIN issues i ON i.id=mi.issue_id JOIN states st ON st.id=i.state_id WHERE mi.module_id=m.id AND mi.deleted_at IS NULL AND i.deleted_at IS NULL AND st.group='completed') AS completed_issues`

func scanModule(row pgx.Row) (ModuleItem, error) {
	var m ModuleItem
	var viewJSON, logoJSON []byte
	err := row.Scan(&m.ID, &m.WorkspaceID, &m.ProjectID, &m.Name, &m.Description,
		&m.StartDate, &m.TargetDate, &m.Status, &m.Lead, &viewJSON, &m.SortOrder,
		&logoJSON, &m.CreatedAt, &m.UpdatedAt, &m.CreatedBy, &m.UpdatedBy,
		&m.IsFavorite, &m.TotalIssues, &m.CompletedIssues)
	if err != nil {
		return ModuleItem{}, err
	}
	m.ViewProps = parseJSON(viewJSON)
	m.LogoProps = parseJSON(logoJSON)
	return m, nil
}

func parseJSON(raw []byte) json.RawMessage {
	if raw == nil || len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(raw)
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]ModuleItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	rows, err := s.Pool.Query(ctx, `SELECT `+moduleColumns+`
		FROM modules m
		WHERE m.project_id::text=$2 AND m.workspace_id::text=$3 AND m.deleted_at IS NULL
		ORDER BY m.sort_order ASC, m.created_at DESC`, identity.UserID, identity.ProjectID, identity.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ModuleItem
	for rows.Next() {
		item, scanErr := scanModule(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, input WritePayload) (ModuleItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return ModuleItem{}, err
	}
	if identity.Role < 15 {
		return ModuleItem{}, ErrForbidden
	}
	if input.Name == nil || *input.Name == "" {
		return ModuleItem{}, fmt.Errorf("%w: name required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ModuleItem{}, err
	}
	defer tx.Rollback(ctx)

	var sortOrder float64
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	} else {
		_ = tx.QueryRow(ctx, `SELECT COALESCE(MIN(sort_order) - 10000, 65535) FROM modules WHERE project_id::text=$1 AND deleted_at IS NULL`, identity.ProjectID).Scan(&sortOrder)
	}

	moduleID := newUUID()
	desc := ""
	if input.Description != nil {
		desc = *input.Description
	}
	status := "backlog"
	if input.Status != nil {
		status = *input.Status
	}
	viewProps := "{}"
	if len(input.ViewProps) > 0 {
		viewProps = string(input.ViewProps)
	}
	logoProps := "{}"
	if len(input.LogoProps) > 0 {
		logoProps = string(input.LogoProps)
	}

	_, err = tx.Exec(ctx, `INSERT INTO modules
		(id, workspace_id, project_id, name, description, start_date, target_date, status, lead_id,
		 view_props, sort_order, logo_props,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,NULLIF($9,'')::uuid,
		$10,$11,$12,
		$13::uuid,$13::uuid,NOW(),NOW())`,
		moduleID, identity.WorkspaceID, identity.ProjectID, *input.Name, desc,
		input.StartDate, input.TargetDate, status, stringValue(input.Lead),
		viewProps, sortOrder, logoProps, identity.UserID)
	if err != nil {
		return ModuleItem{}, err
	}

	item, err := scanModule(tx.QueryRow(ctx, `SELECT `+moduleColumns+` FROM modules m WHERE m.id::text=$2`, identity.UserID, moduleID))
	if err != nil {
		return ModuleItem{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ModuleItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, moduleID string, input WritePayload) (ModuleItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return ModuleItem{}, err
	}
	if identity.Role < 15 {
		return ModuleItem{}, ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ModuleItem{}, err
	}
	defer tx.Rollback(ctx)

	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM modules WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`,
		moduleID, identity.ProjectID).Scan(&exists)
	if err != nil {
		return ModuleItem{}, err
	}
	if !exists {
		return ModuleItem{}, ErrNotFound
	}

	vp := "{}"
	if input.has("view_props") && len(input.ViewProps) > 0 {
		vp = string(input.ViewProps)
	}
	lp := "{}"
	if input.has("logo_props") && len(input.LogoProps) > 0 {
		lp = string(input.LogoProps)
	}

	_, err = tx.Exec(ctx, `UPDATE modules SET
		name=CASE WHEN $4 THEN $5 ELSE name END,
		description=CASE WHEN $6 THEN $7 ELSE description END,
		start_date=CASE WHEN $8 THEN $9 ELSE start_date END,
		target_date=CASE WHEN $10 THEN $11 ELSE target_date END,
		status=CASE WHEN $12 THEN $13 ELSE status END,
		lead_id=CASE WHEN $14 THEN NULLIF($15,'')::uuid ELSE lead_id END,
		view_props=CASE WHEN $16 THEN $17 ELSE view_props END,
		sort_order=CASE WHEN $18 THEN $19 ELSE sort_order END,
		logo_props=CASE WHEN $20 THEN $21 ELSE logo_props END,
		updated_by_id=$22, updated_at=NOW()
		WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`,
		moduleID, identity.ProjectID, identity.WorkspaceID,
		input.has("name"), input.Name,
		input.has("description"), input.Description,
		input.has("start_date"), input.StartDate,
		input.has("target_date"), input.TargetDate,
		input.has("status"), input.Status,
		input.has("lead"), stringValue(input.Lead),
		input.has("view_props"), vp,
		input.has("sort_order"), input.SortOrder,
		input.has("logo_props"), lp,
		identity.UserID)
	if err != nil {
		return ModuleItem{}, err
	}

	item, err := scanModule(tx.QueryRow(ctx, `SELECT `+moduleColumns+` FROM modules m WHERE m.id::text=$2`, identity.UserID, moduleID))
	if err != nil {
		return ModuleItem{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ModuleItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, moduleID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if identity.Role < 15 {
		return ErrForbidden
	}

	res, err := s.Pool.Exec(ctx, `UPDATE modules SET deleted_at=NOW(), updated_by_id=$3, updated_at=NOW()
		WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`,
		moduleID, identity.ProjectID, identity.UserID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func stringValue(val *string) string {
	if val == nil {
		return ""
	}
	return *val
}
