package estimate

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Estimate struct {
	ID             string          `json:"id"`
	WorkspaceID    string          `json:"workspace"`
	ProjectID      string          `json:"project"`
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	Type           string          `json:"type"`
	LastUsed       bool            `json:"last_used"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	EstimatePoints []EstimatePoint `json:"points"`
}

type EstimatePoint struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace"`
	ProjectID   string    `json:"project"`
	EstimateID  string    `json:"estimate"`
	Key         int       `json:"key"`
	Description string    `json:"description"`
	Value       string    `json:"value"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type EstimateInput struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Type        *string `json:"type"`
	LastUsed    *bool   `json:"last_used"`
}

type EstimatePointInput struct {
	ID          *string `json:"id"`
	Key         *int    `json:"key"`
	Description *string `json:"description"`
	Value       *string `json:"value"`
}

type WritePayload struct {
	Estimate       *EstimateInput       `json:"estimate"`
	EstimatePoints []EstimatePointInput `json:"estimate_points"`
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

type projectAccess struct {
	WorkspaceID string
	UserID      string
	Role        int
}

const estimateColumns = `e.id::text,e.workspace_id::text,e.project_id::text,e.name,e.description,e.type,e.last_used,e.created_at,e.updated_at`
const pointColumns = `ep.id::text,ep.workspace_id::text,ep.project_id::text,ep.estimate_id::text,ep.key,ep.description,ep.value,ep.created_at,ep.updated_at`

func (s PostgreSQLStore) projectIdentity(ctx context.Context, sessionKey, slug, projectID string) (projectAccess, error) {
	if sessionKey == "" {
		return projectAccess{}, ErrUnauthorized
	}
	var access projectAccess
	err := s.Pool.QueryRow(ctx, `SELECT w.id::text,session.user_id::text,pm.role
		FROM sessions session
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id=session.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE session.session_key=$1 AND session.expire_date>NOW()`, sessionKey, slug, projectID).
		Scan(&access.WorkspaceID, &access.UserID, &access.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return projectAccess{}, ErrForbidden
	}
	return access, err
}

func (s PostgreSQLStore) workspaceIdentity(ctx context.Context, sessionKey, slug string) (string, error) {
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var workspaceID string
	err := s.Pool.QueryRow(ctx, `SELECT w.id::text
		FROM sessions session
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id=session.user_id
			AND wm.is_active=TRUE AND wm.deleted_at IS NULL
		WHERE session.session_key=$1 AND session.expire_date>NOW()`, sessionKey, slug).Scan(&workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrForbidden
	}
	return workspaceID, err
}

type rowScanner interface{ Scan(...any) error }

func scanEstimate(row rowScanner) (Estimate, error) {
	var item Estimate
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.ProjectID, &item.Name, &item.Description,
		&item.Type, &item.LastUsed, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func scanPoint(row rowScanner) (EstimatePoint, error) {
	var item EstimatePoint
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.ProjectID, &item.EstimateID, &item.Key,
		&item.Description, &item.Value, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s PostgreSQLStore) attachPoints(ctx context.Context, items []Estimate) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	index := make(map[string]int, len(items))
	for i := range items {
		ids[i] = items[i].ID
		index[items[i].ID] = i
		items[i].EstimatePoints = make([]EstimatePoint, 0)
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+pointColumns+` FROM estimate_points ep
		WHERE ep.estimate_id::text=ANY($1) AND ep.deleted_at IS NULL ORDER BY ep.key`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		point, scanErr := scanPoint(rows)
		if scanErr != nil {
			return scanErr
		}
		if i, ok := index[point.EstimateID]; ok {
			items[i].EstimatePoints = append(items[i].EstimatePoints, point)
		}
	}
	return rows.Err()
}

func (s PostgreSQLStore) list(ctx context.Context, query string, args ...any) ([]Estimate, error) {
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Estimate, 0)
	for rows.Next() {
		item, scanErr := scanEstimate(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.attachPoints(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s PostgreSQLStore) ListWorkspaceForSession(ctx context.Context, sessionKey, slug string) ([]Estimate, error) {
	workspaceID, err := s.workspaceIdentity(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	return s.list(ctx, `SELECT DISTINCT `+estimateColumns+` FROM estimates e
		JOIN projects p ON p.estimate_id=e.id AND p.deleted_at IS NULL
		WHERE e.workspace_id=$1 AND e.deleted_at IS NULL ORDER BY e.name`, workspaceID)
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]Estimate, error) {
	if _, err := s.projectIdentity(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	return s.list(ctx, `SELECT `+estimateColumns+` FROM estimates e
		WHERE e.project_id=$1 AND e.deleted_at IS NULL ORDER BY e.name`, projectID)
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID, estimateID string) (Estimate, error) {
	if _, err := s.projectIdentity(ctx, sessionKey, slug, projectID); err != nil {
		return Estimate{}, err
	}
	item, err := scanEstimate(s.Pool.QueryRow(ctx, `SELECT `+estimateColumns+` FROM estimates e
		WHERE e.id=$1 AND e.project_id=$2 AND e.deleted_at IS NULL`, estimateID, projectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Estimate{}, ErrNotFound
	}
	if err != nil {
		return Estimate{}, err
	}
	items := []Estimate{item}
	if err := s.attachPoints(ctx, items); err != nil {
		return Estimate{}, err
	}
	return items[0], nil
}

func validateEstimate(input *EstimateInput, creating bool) error {
	if input == nil {
		return fmt.Errorf("estimate is required: %w", ErrInvalid)
	}
	if creating && (input.Name == nil || strings.TrimSpace(*input.Name) == "") {
		return fmt.Errorf("name is required: %w", ErrInvalid)
	}
	if input.Type != nil && *input.Type != "points" && *input.Type != "categories" {
		return fmt.Errorf("type must be points or categories: %w", ErrInvalid)
	}
	return nil
}

func validatePoint(input EstimatePointInput, creating bool) error {
	if creating && (input.Key == nil || input.Value == nil) {
		return fmt.Errorf("key and value are required: %w", ErrInvalid)
	}
	if input.Key != nil && *input.Key < 0 {
		return fmt.Errorf("key cannot be negative: %w", ErrInvalid)
	}
	if input.Value != nil && len(*input.Value) > 20 {
		return fmt.Errorf("value cannot exceed 20 characters: %w", ErrInvalid)
	}
	return nil
}

func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	value := hex.EncodeToString(b[:])
	return fmt.Sprintf("%s-%s-%s-%s-%s", value[:8], value[8:12], value[12:16], value[16:20], value[20:]), nil
}

func insertPoint(ctx context.Context, tx pgx.Tx, access projectAccess, projectID, estimateID string, input EstimatePointInput) error {
	if err := validatePoint(input, true); err != nil {
		return err
	}
	id, err := newUUID()
	if err != nil {
		return err
	}
	description := ""
	if input.Description != nil {
		description = *input.Description
	}
	_, err = tx.Exec(ctx, `INSERT INTO estimate_points
		(id,key,description,value,estimate_id,project_id,workspace_id,created_at,updated_at,created_by_id,updated_by_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),$8,$8)`, id, *input.Key, description, *input.Value,
		estimateID, projectID, access.WorkspaceID, access.UserID)
	return err
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, payload WritePayload) (Estimate, error) {
	access, err := s.projectIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Estimate{}, err
	}
	if access.Role < 15 {
		return Estimate{}, ErrForbidden
	}
	if err := validateEstimate(payload.Estimate, true); err != nil {
		return Estimate{}, err
	}
	for _, point := range payload.EstimatePoints {
		if err := validatePoint(point, true); err != nil {
			return Estimate{}, err
		}
	}
	id, err := newUUID()
	if err != nil {
		return Estimate{}, err
	}
	description, estimateType, lastUsed := "", "points", false
	if payload.Estimate.Description != nil {
		description = *payload.Estimate.Description
	}
	if payload.Estimate.Type != nil {
		estimateType = *payload.Estimate.Type
	}
	if payload.Estimate.LastUsed != nil {
		lastUsed = *payload.Estimate.LastUsed
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Estimate{}, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO estimates
		(id,name,description,type,last_used,project_id,workspace_id,created_at,updated_at,created_by_id,updated_by_id)
		VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),$8,$8)`, id, strings.TrimSpace(*payload.Estimate.Name),
		description, estimateType, lastUsed, projectID, access.WorkspaceID, access.UserID)
	if err != nil {
		return Estimate{}, err
	}
	for _, point := range payload.EstimatePoints {
		if err := insertPoint(ctx, tx, access, projectID, id, point); err != nil {
			return Estimate{}, err
		}
	}
	if lastUsed {
		if _, err := tx.Exec(ctx, `UPDATE projects SET estimate_id=$1,updated_at=NOW(),updated_by_id=$2 WHERE id=$3`, id, access.UserID, projectID); err != nil {
			return Estimate{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Estimate{}, err
	}
	return s.GetForSession(ctx, sessionKey, slug, projectID, id)
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, estimateID string, payload WritePayload) (Estimate, error) {
	access, err := s.projectIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Estimate{}, err
	}
	if access.Role < 15 {
		return Estimate{}, ErrForbidden
	}
	if err := validateEstimate(payload.Estimate, false); err != nil {
		return Estimate{}, err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Estimate{}, err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE estimates SET
		name=COALESCE($1,name),description=COALESCE($2,description),type=COALESCE($3,type),last_used=COALESCE($4,last_used),
		updated_at=NOW(),updated_by_id=$5 WHERE id=$6 AND project_id=$7 AND deleted_at IS NULL`,
		payload.Estimate.Name, payload.Estimate.Description, payload.Estimate.Type, payload.Estimate.LastUsed,
		access.UserID, estimateID, projectID)
	if err != nil {
		return Estimate{}, err
	}
	if result.RowsAffected() == 0 {
		return Estimate{}, ErrNotFound
	}
	for _, point := range payload.EstimatePoints {
		if point.ID == nil || strings.TrimSpace(*point.ID) == "" {
			if err := insertPoint(ctx, tx, access, projectID, estimateID, point); err != nil {
				return Estimate{}, err
			}
			continue
		}
		if err := validatePoint(point, false); err != nil {
			return Estimate{}, err
		}
		if _, err := tx.Exec(ctx, `UPDATE estimate_points SET key=COALESCE($1,key),description=COALESCE($2,description),
			value=COALESCE($3,value),updated_at=NOW(),updated_by_id=$4
			WHERE id=$5 AND estimate_id=$6 AND deleted_at IS NULL`,
			point.Key, point.Description, point.Value, access.UserID, *point.ID, estimateID); err != nil {
			return Estimate{}, err
		}
	}
	if payload.Estimate.LastUsed != nil && *payload.Estimate.LastUsed {
		if _, err := tx.Exec(ctx, `UPDATE projects SET estimate_id=$1,updated_at=NOW(),updated_by_id=$2 WHERE id=$3`, estimateID, access.UserID, projectID); err != nil {
			return Estimate{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Estimate{}, err
	}
	return s.GetForSession(ctx, sessionKey, slug, projectID, estimateID)
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, estimateID string) error {
	access, err := s.projectIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if access.Role < 15 {
		return ErrForbidden
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE projects SET estimate_id=NULL,updated_at=NOW(),updated_by_id=$1
		WHERE id=$2 AND estimate_id=$3`, access.UserID, projectID, estimateID); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `UPDATE estimates SET deleted_at=NOW(),updated_at=NOW(),updated_by_id=$1
		WHERE id=$2 AND project_id=$3 AND deleted_at IS NULL`, access.UserID, estimateID, projectID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, `UPDATE estimate_points SET deleted_at=NOW(),updated_at=NOW(),updated_by_id=$1
		WHERE estimate_id=$2 AND deleted_at IS NULL`, access.UserID, estimateID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s PostgreSQLStore) ListPointsForSession(ctx context.Context, sessionKey, slug, projectID, estimateID string) ([]EstimatePoint, error) {
	if _, err := s.projectIdentity(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+pointColumns+` FROM estimate_points ep
		WHERE ep.estimate_id=$1 AND ep.project_id=$2 AND ep.deleted_at IS NULL ORDER BY ep.key`, estimateID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]EstimatePoint, 0)
	for rows.Next() {
		item, scanErr := scanPoint(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) CreatePointsForSession(ctx context.Context, sessionKey, slug, projectID, estimateID string, inputs []EstimatePointInput) ([]EstimatePoint, error) {
	access, err := s.projectIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}
	if access.Role < 15 {
		return nil, ErrForbidden
	}
	if _, err := s.GetForSession(ctx, sessionKey, slug, projectID, estimateID); err != nil {
		return nil, err
	}
	if len(inputs) == 0 {
		return nil, fmt.Errorf("estimate points are required: %w", ErrInvalid)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	for _, input := range inputs {
		if err := insertPoint(ctx, tx, access, projectID, estimateID, input); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.ListPointsForSession(ctx, sessionKey, slug, projectID, estimateID)
}

func (s PostgreSQLStore) UpdatePointForSession(ctx context.Context, sessionKey, slug, projectID, estimateID, pointID string, input EstimatePointInput) (EstimatePoint, error) {
	access, err := s.projectIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return EstimatePoint{}, err
	}
	if access.Role < 15 {
		return EstimatePoint{}, ErrForbidden
	}
	if err := validatePoint(input, false); err != nil {
		return EstimatePoint{}, err
	}
	result, err := s.Pool.Exec(ctx, `UPDATE estimate_points SET key=COALESCE($1,key),description=COALESCE($2,description),
		value=COALESCE($3,value),updated_at=NOW(),updated_by_id=$4
		WHERE id=$5 AND estimate_id=$6 AND project_id=$7 AND deleted_at IS NULL`,
		input.Key, input.Description, input.Value, access.UserID, pointID, estimateID, projectID)
	if err != nil {
		return EstimatePoint{}, err
	}
	if result.RowsAffected() == 0 {
		return EstimatePoint{}, ErrPointNotFound
	}
	item, err := scanPoint(s.Pool.QueryRow(ctx, `SELECT `+pointColumns+` FROM estimate_points ep WHERE ep.id=$1`, pointID))
	return item, err
}

func (s PostgreSQLStore) DeletePointForSession(ctx context.Context, sessionKey, slug, projectID, estimateID, pointID string) error {
	access, err := s.projectIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if access.Role < 15 {
		return ErrForbidden
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE estimate_points SET deleted_at=NOW(),updated_at=NOW(),updated_by_id=$1
		WHERE id=$2 AND estimate_id=$3 AND project_id=$4 AND deleted_at IS NULL`, access.UserID, pointID, estimateID, projectID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrPointNotFound
	}
	if _, err := tx.Exec(ctx, `UPDATE issues SET estimate_point_id=NULL,updated_at=NOW(),updated_by_id=$1
		WHERE estimate_point_id=$2`, access.UserID, pointID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
