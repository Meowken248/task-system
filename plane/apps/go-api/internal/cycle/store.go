package cycle

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
	ErrNotFound     = errors.New("cycle not found")
	ErrInvalid      = errors.New("invalid payload")
)

type CycleItem struct {
	ID               string          `json:"id"`
	WorkspaceID      string          `json:"workspace"`
	ProjectID        string          `json:"project"`
	Name             string          `json:"name"`
	Description      string          `json:"description"`
	StartDate        *time.Time      `json:"start_date"`
	EndDate          *time.Time      `json:"end_date"`
	OwnedBy          string          `json:"owned_by"`
	ViewProps        json.RawMessage `json:"view_props"`
	SortOrder        float64         `json:"sort_order"`
	ExternalSource   *string         `json:"external_source"`
	ExternalID       *string         `json:"external_id"`
	ProgressSnapshot json.RawMessage `json:"progress_snapshot"`
	LogoProps        json.RawMessage `json:"logo_props"`
	Timezone         string          `json:"timezone"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	CreatedBy        string          `json:"created_by"`
	UpdatedBy        string          `json:"updated_by"`
	IsFavorite       bool            `json:"is_favorite"`
	TotalIssues      int             `json:"total_issues"`
	CompletedIssues  int             `json:"completed_issues"`
	TotalEstimates   float64         `json:"total_estimates"`
	CompletedEstimates float64       `json:"completed_estimates"`
}

type WritePayload struct {
	Name        *string         `json:"name"`
	Description *string         `json:"description"`
	StartDate   *time.Time      `json:"start_date"`
	EndDate     *time.Time      `json:"end_date"`
	ViewProps   json.RawMessage `json:"view_props"`
	SortOrder   *float64        `json:"sort_order"`
	LogoProps   json.RawMessage `json:"logo_props"`
	Timezone    *string         `json:"timezone"`
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

const cycleColumns = `c.id::text, c.workspace_id::text, c.project_id::text, c.name, c.description,
	c.start_date, c.end_date, c.owned_by_id::text, c.view_props, c.sort_order,
	c.external_source, c.external_id, c.progress_snapshot, c.logo_props, c.timezone,
	c.created_at, c.updated_at, c.created_by_id::text, c.updated_by_id::text,
	EXISTS(SELECT 1 FROM user_favorites f WHERE f.entity_type='cycle' AND f.entity_identifier::text=c.id::text AND f.user_id::text=$1 AND f.deleted_at IS NULL) AS is_favorite,
	(SELECT COUNT(ci.issue_id)::int FROM cycle_issues ci JOIN issues i ON i.id=ci.issue_id WHERE ci.cycle_id=c.id AND ci.deleted_at IS NULL AND i.deleted_at IS NULL) AS total_issues,
	(SELECT COUNT(ci.issue_id)::int FROM cycle_issues ci JOIN issues i ON i.id=ci.issue_id JOIN states st ON st.id=i.state_id WHERE ci.cycle_id=c.id AND ci.deleted_at IS NULL AND i.deleted_at IS NULL AND st.group='completed') AS completed_issues`

func scanCycle(row pgx.Row) (CycleItem, error) {
	var c CycleItem
	var viewJSON, progJSON, logoJSON []byte
	err := row.Scan(&c.ID, &c.WorkspaceID, &c.ProjectID, &c.Name, &c.Description,
		&c.StartDate, &c.EndDate, &c.OwnedBy, &viewJSON, &c.SortOrder,
		&c.ExternalSource, &c.ExternalID, &progJSON, &logoJSON, &c.Timezone,
		&c.CreatedAt, &c.UpdatedAt, &c.CreatedBy, &c.UpdatedBy,
		&c.IsFavorite, &c.TotalIssues, &c.CompletedIssues)
	if err != nil {
		return CycleItem{}, err
	}
	c.ViewProps = parseJSON(viewJSON)
	c.ProgressSnapshot = parseJSON(progJSON)
	c.LogoProps = parseJSON(logoJSON)
	return c, nil
}

func parseJSON(raw []byte) json.RawMessage {
	if raw == nil || len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(raw)
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]CycleItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	rows, err := s.Pool.Query(ctx, `SELECT `+cycleColumns+`
		FROM cycles c
		WHERE c.project_id::text=$2 AND c.workspace_id::text=$3 AND c.deleted_at IS NULL
		ORDER BY c.sort_order ASC, c.created_at DESC`, identity.UserID, identity.ProjectID, identity.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []CycleItem
	for rows.Next() {
		item, scanErr := scanCycle(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, input WritePayload) (CycleItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return CycleItem{}, err
	}
	if identity.Role < 15 {
		return CycleItem{}, ErrForbidden
	}
	if input.Name == nil || *input.Name == "" {
		return CycleItem{}, fmt.Errorf("%w: name required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return CycleItem{}, err
	}
	defer tx.Rollback(ctx)

	var sortOrder float64
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	} else {
		_ = tx.QueryRow(ctx, `SELECT COALESCE(MIN(sort_order) - 10000, 65535) FROM cycles WHERE project_id::text=$1 AND deleted_at IS NULL`, identity.ProjectID).Scan(&sortOrder)
	}

	cycleID := newUUID()
	desc := ""
	if input.Description != nil {
		desc = *input.Description
	}
	tz := "UTC"
	if input.Timezone != nil {
		tz = *input.Timezone
	}
	viewProps := "{}"
	if len(input.ViewProps) > 0 {
		viewProps = string(input.ViewProps)
	}
	logoProps := "{}"
	if len(input.LogoProps) > 0 {
		logoProps = string(input.LogoProps)
	}

	_, err = tx.Exec(ctx, `INSERT INTO cycles
		(id, workspace_id, project_id, name, description, start_date, end_date, owned_by_id,
		 view_props, sort_order, logo_props, timezone, progress_snapshot, version,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::uuid,$9,$10,$11,$12,'{}',1,
		$8::uuid,$8::uuid,NOW(),NOW())`,
		cycleID, identity.WorkspaceID, identity.ProjectID, *input.Name, desc,
		input.StartDate, input.EndDate, identity.UserID,
		viewProps, sortOrder, logoProps, tz)
	if err != nil {
		return CycleItem{}, err
	}

	item, err := scanCycle(tx.QueryRow(ctx, `SELECT `+cycleColumns+` FROM cycles c WHERE c.id::text=$2`, identity.UserID, cycleID))
	if err != nil {
		return CycleItem{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CycleItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, cycleID string, input WritePayload) (CycleItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return CycleItem{}, err
	}
	if identity.Role < 15 {
		return CycleItem{}, ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return CycleItem{}, err
	}
	defer tx.Rollback(ctx)

	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM cycles WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`,
		cycleID, identity.ProjectID).Scan(&exists)
	if err != nil {
		return CycleItem{}, err
	}
	if !exists {
		return CycleItem{}, ErrNotFound
	}

	vp := "{}"
	if input.has("view_props") && len(input.ViewProps) > 0 {
		vp = string(input.ViewProps)
	}
	lp := "{}"
	if input.has("logo_props") && len(input.LogoProps) > 0 {
		lp = string(input.LogoProps)
	}

	_, err = tx.Exec(ctx, `UPDATE cycles SET
		name=CASE WHEN $4 THEN $5 ELSE name END,
		description=CASE WHEN $6 THEN $7 ELSE description END,
		start_date=CASE WHEN $8 THEN $9 ELSE start_date END,
		end_date=CASE WHEN $10 THEN $11 ELSE end_date END,
		view_props=CASE WHEN $12 THEN $13 ELSE view_props END,
		sort_order=CASE WHEN $14 THEN $15 ELSE sort_order END,
		logo_props=CASE WHEN $16 THEN $17 ELSE logo_props END,
		timezone=CASE WHEN $18 THEN $19 ELSE timezone END,
		updated_by_id=$20, updated_at=NOW()
		WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`,
		cycleID, identity.ProjectID, identity.WorkspaceID,
		input.has("name"), input.Name,
		input.has("description"), input.Description,
		input.has("start_date"), input.StartDate,
		input.has("end_date"), input.EndDate,
		input.has("view_props"), vp,
		input.has("sort_order"), input.SortOrder,
		input.has("logo_props"), lp,
		input.has("timezone"), input.Timezone,
		identity.UserID)
	if err != nil {
		return CycleItem{}, err
	}

	item, err := scanCycle(tx.QueryRow(ctx, `SELECT `+cycleColumns+` FROM cycles c WHERE c.id::text=$2`, identity.UserID, cycleID))
	if err != nil {
		return CycleItem{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return CycleItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, cycleID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if identity.Role < 15 {
		return ErrForbidden
	}

	res, err := s.Pool.Exec(ctx, `UPDATE cycles SET deleted_at=NOW(), updated_by_id=$3, updated_at=NOW()
		WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL`,
		cycleID, identity.ProjectID, identity.UserID)
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
