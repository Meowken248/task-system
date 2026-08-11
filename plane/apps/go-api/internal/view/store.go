package view

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
	ErrNotFound     = errors.New("view not found")
	ErrInvalid      = errors.New("invalid payload")
)

type ViewItem struct {
	ID                string          `json:"id"`
	WorkspaceID       string          `json:"workspace"`
	ProjectID         string          `json:"project"`
	Name              string          `json:"name"`
	Description       string          `json:"description"`
	Query             json.RawMessage `json:"query"`
	Filters           json.RawMessage `json:"filters"`
	DisplayFilters    json.RawMessage `json:"display_filters"`
	DisplayProperties json.RawMessage `json:"display_properties"`
	RichFilters       json.RawMessage `json:"rich_filters"`
	Access            int             `json:"access"`
	SortOrder         float64         `json:"sort_order"`
	LogoProps         json.RawMessage `json:"logo_props"`
	OwnedBy           string          `json:"owned_by"`
	IsLocked          bool            `json:"is_locked"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
	CreatedBy         string          `json:"created_by"`
	UpdatedBy         string          `json:"updated_by"`
	IsFavorite        bool            `json:"is_favorite"`
}

type WritePayload struct {
	Name              *string         `json:"name"`
	Description       *string         `json:"description"`
	Query             json.RawMessage `json:"query"`
	Filters           json.RawMessage `json:"filters"`
	DisplayFilters    json.RawMessage `json:"display_filters"`
	DisplayProperties json.RawMessage `json:"display_properties"`
	RichFilters       json.RawMessage `json:"rich_filters"`
	Access            *int            `json:"access"`
	SortOrder         *float64        `json:"sort_order"`
	LogoProps         json.RawMessage `json:"logo_props"`
	IsLocked          *bool           `json:"is_locked"`
	present           map[string]bool
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

const viewColumns = `v.id::text, v.workspace_id::text, v.project_id::text, v.name, v.description,
	v.query, v.filters, v.display_filters, v.display_properties, v.rich_filters,
	v.access, v.sort_order, v.logo_props, v.owned_by_id::text, v.is_locked,
	v.created_at, v.updated_at, v.created_by_id::text, v.updated_by_id::text,
	EXISTS(SELECT 1 FROM user_favorites f WHERE f.entity_type='view' AND f.entity_identifier::text=v.id::text AND f.user_id::text=$1 AND f.deleted_at IS NULL) AS is_favorite`

func scanView(row pgx.Row) (ViewItem, error) {
	var v ViewItem
	var queryJSON, filtersJSON, dFiltersJSON, dPropsJSON, rFiltersJSON, logoJSON []byte
	err := row.Scan(&v.ID, &v.WorkspaceID, &v.ProjectID, &v.Name, &v.Description,
		&queryJSON, &filtersJSON, &dFiltersJSON, &dPropsJSON, &rFiltersJSON,
		&v.Access, &v.SortOrder, &logoJSON, &v.OwnedBy, &v.IsLocked,
		&v.CreatedAt, &v.UpdatedAt, &v.CreatedBy, &v.UpdatedBy, &v.IsFavorite)
	if err != nil {
		return ViewItem{}, err
	}
	v.Query = parseJSON(queryJSON)
	v.Filters = parseJSON(filtersJSON)
	v.DisplayFilters = parseJSON(dFiltersJSON)
	v.DisplayProperties = parseJSON(dPropsJSON)
	v.RichFilters = parseJSON(rFiltersJSON)
	v.LogoProps = parseJSON(logoJSON)
	return v, nil
}

func parseJSON(raw []byte) json.RawMessage {
	if raw == nil || len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(raw)
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]ViewItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	rows, err := s.Pool.Query(ctx, `SELECT `+viewColumns+`
		FROM issue_views v
		WHERE v.project_id::text=$2 AND v.workspace_id::text=$3 AND v.deleted_at IS NULL
		ORDER BY v.sort_order ASC, v.created_at DESC`, identity.UserID, identity.ProjectID, identity.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ViewItem
	for rows.Next() {
		item, scanErr := scanView(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, input WritePayload) (ViewItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return ViewItem{}, err
	}
	if identity.Role < 15 {
		return ViewItem{}, ErrForbidden
	}
	if input.Name == nil || *input.Name == "" {
		return ViewItem{}, fmt.Errorf("%w: name required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ViewItem{}, err
	}
	defer tx.Rollback(ctx)

	var sortOrder float64
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	} else {
		_ = tx.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order) + 10000, 65535) FROM issue_views WHERE project_id::text=$1 AND deleted_at IS NULL`, identity.ProjectID).Scan(&sortOrder)
	}

	viewID := newUUID()
	desc := ""
	if input.Description != nil {
		desc = *input.Description
	}
	access := 1
	if input.Access != nil {
		access = *input.Access
	}
	isLocked := false
	if input.IsLocked != nil {
		isLocked = *input.IsLocked
	}
	queryProps := "{}"
	if len(input.Query) > 0 {
		queryProps = string(input.Query)
	}
	filtersProps := "{}"
	if len(input.Filters) > 0 {
		filtersProps = string(input.Filters)
	}
	dFiltersProps := "{}"
	if len(input.DisplayFilters) > 0 {
		dFiltersProps = string(input.DisplayFilters)
	}
	dPropsProps := "{}"
	if len(input.DisplayProperties) > 0 {
		dPropsProps = string(input.DisplayProperties)
	}
	rFiltersProps := "{}"
	if len(input.RichFilters) > 0 {
		rFiltersProps = string(input.RichFilters)
	}
	logoProps := "{}"
	if len(input.LogoProps) > 0 {
		logoProps = string(input.LogoProps)
	}

	_, err = tx.Exec(ctx, `INSERT INTO issue_views
		(id, workspace_id, project_id, name, description, query, filters, display_filters, display_properties, rich_filters,
		 access, sort_order, logo_props, owned_by_id, is_locked,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,
		$11,$12,$13,$14::uuid,$15,
		$14::uuid,$14::uuid,NOW(),NOW())`,
		viewID, identity.WorkspaceID, identity.ProjectID, *input.Name, desc, queryProps, filtersProps, dFiltersProps, dPropsProps, rFiltersProps,
		access, sortOrder, logoProps, identity.UserID, isLocked)
	if err != nil {
		return ViewItem{}, err
	}

	item, err := scanView(tx.QueryRow(ctx, `SELECT `+viewColumns+` FROM issue_views v WHERE v.id::text=$2`, identity.UserID, viewID))
	if err != nil {
		return ViewItem{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ViewItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, viewID string, input WritePayload) (ViewItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return ViewItem{}, err
	}
	if identity.Role < 15 {
		return ViewItem{}, ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ViewItem{}, err
	}
	defer tx.Rollback(ctx)

	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issue_views WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`,
		viewID, identity.ProjectID).Scan(&exists)
	if err != nil {
		return ViewItem{}, err
	}
	if !exists {
		return ViewItem{}, ErrNotFound
	}

	qp, fp, dfp, dpp, rfp, lp := "{}", "{}", "{}", "{}", "{}", "{}"
	if input.has("query") && len(input.Query) > 0 {
		qp = string(input.Query)
	}
	if input.has("filters") && len(input.Filters) > 0 {
		fp = string(input.Filters)
	}
	if input.has("display_filters") && len(input.DisplayFilters) > 0 {
		dfp = string(input.DisplayFilters)
	}
	if input.has("display_properties") && len(input.DisplayProperties) > 0 {
		dpp = string(input.DisplayProperties)
	}
	if input.has("rich_filters") && len(input.RichFilters) > 0 {
		rfp = string(input.RichFilters)
	}
	if input.has("logo_props") && len(input.LogoProps) > 0 {
		lp = string(input.LogoProps)
	}

	_, err = tx.Exec(ctx, `UPDATE issue_views SET
		name=CASE WHEN $4 THEN $5 ELSE name END,
		description=CASE WHEN $6 THEN $7 ELSE description END,
		query=CASE WHEN $8 THEN $9 ELSE query END,
		filters=CASE WHEN $10 THEN $11 ELSE filters END,
		display_filters=CASE WHEN $12 THEN $13 ELSE display_filters END,
		display_properties=CASE WHEN $14 THEN $15 ELSE display_properties END,
		rich_filters=CASE WHEN $16 THEN $17 ELSE rich_filters END,
		access=CASE WHEN $18 THEN $19 ELSE access END,
		sort_order=CASE WHEN $20 THEN $21 ELSE sort_order END,
		logo_props=CASE WHEN $22 THEN $23 ELSE logo_props END,
		is_locked=CASE WHEN $24 THEN $25 ELSE is_locked END,
		updated_by_id=$26, updated_at=NOW()
		WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`,
		viewID, identity.ProjectID, identity.WorkspaceID,
		input.has("name"), input.Name,
		input.has("description"), input.Description,
		input.has("query"), qp,
		input.has("filters"), fp,
		input.has("display_filters"), dfp,
		input.has("display_properties"), dpp,
		input.has("rich_filters"), rfp,
		input.has("access"), input.Access,
		input.has("sort_order"), input.SortOrder,
		input.has("logo_props"), lp,
		input.has("is_locked"), input.IsLocked,
		identity.UserID)
	if err != nil {
		return ViewItem{}, err
	}

	item, err := scanView(tx.QueryRow(ctx, `SELECT `+viewColumns+` FROM issue_views v WHERE v.id::text=$2`, identity.UserID, viewID))
	if err != nil {
		return ViewItem{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ViewItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, viewID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if identity.Role < 15 {
		return ErrForbidden
	}

	res, err := s.Pool.Exec(ctx, `UPDATE issue_views SET deleted_at=NOW(), updated_by_id=$3, updated_at=NOW()
		WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`,
		viewID, identity.ProjectID, identity.UserID)
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
