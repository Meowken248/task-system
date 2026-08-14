package intake

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Intake struct {
	ID          string                 `json:"id"`
	WorkspaceID string                 `json:"workspace"`
	ProjectID   string                 `json:"project"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	IsDefault   bool                   `json:"is_default"`
	ViewProps   map[string]interface{} `json:"view_props"`
	LogoProps   map[string]interface{} `json:"logo_props"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}
type IntakeIssue struct {
	ID             string                 `json:"id"`
	WorkspaceID    string                 `json:"workspace"`
	ProjectID      string                 `json:"project"`
	IntakeID       string                 `json:"intake"`
	IssueID        string                 `json:"issue"`
	Status         int                    `json:"status"`
	SnoozedTill    *time.Time             `json:"snoozed_till"`
	DuplicateToID  *string                `json:"duplicate_to"`
	Source         *string                `json:"source"`
	SourceEmail    *string                `json:"source_email"`
	ExternalSource *string                `json:"external_source"`
	ExternalID     *string                `json:"external_id"`
	Extra          map[string]interface{} `json:"extra"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}
type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) resolveUser(ctx context.Context, sessionKey, slug, projectID string) (string, error) {
	if s.Pool == nil {
		return "", errors.New("intake database unavailable")
	}
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text = $3 AND p.workspace_id = w.id AND p.archived_at IS NULL AND p.deleted_at IS NULL
		JOIN project_members pm ON pm.project_id = p.id AND pm.member_id::text = s.user_id
			AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`, sessionKey, slug, projectID).Scan(&userID)
	if err != nil {
		return "", ErrForbidden
	}
	return userID, nil
}

func scanIntake(row pgx.Row) (map[string]any, error) {
	var id, workspaceID, projectID, name, description string
	var isDefault bool
	var viewProps, logoProps map[string]any
	var createdAt, updatedAt time.Time
	if err := row.Scan(&id, &workspaceID, &projectID, &name, &description, &isDefault, &viewProps, &logoProps, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "workspace": workspaceID, "project": projectID, "name": name,
		"description": description, "is_default": isDefault, "view_props": viewProps, "logo_props": logoProps,
		"created_at": createdAt, "updated_at": updatedAt,
	}, nil
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) (any, error) {
	_, err := s.resolveUser(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	row := s.Pool.QueryRow(ctx, `SELECT id,workspace_id,project_id,name,description,is_default,view_props,logo_props,created_at,updated_at
		FROM intakes WHERE project_id=$1 AND deleted_at IS NULL ORDER BY name ASC LIMIT 1`, projectID)
	
	item, err := scanIntake(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	return item, nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID, intakeID string) (any, error) {
	_, err := s.resolveUser(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	row := s.Pool.QueryRow(ctx, `SELECT id,workspace_id,project_id,name,description,is_default,view_props,logo_props,created_at,updated_at
		FROM intakes WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL`, intakeID, projectID)
	
	item, err := scanIntake(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, payload WritePayload) (any, error) {
	_, err := s.resolveUser(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	var workspaceID string
	err = s.Pool.QueryRow(ctx, `SELECT workspace_id FROM projects WHERE id::text=$1 AND deleted_at IS NULL`, projectID).Scan(&workspaceID)
	if err != nil {
		return nil, err
	}

	name := ""
	if payload.Name != nil {
		name = *payload.Name
	}
	description := ""
	if payload.Description != nil {
		description = *payload.Description
	}

	row := s.Pool.QueryRow(ctx, `
		INSERT INTO intakes (workspace_id, project_id, name, description, is_default, view_props, logo_props, created_at, updated_at)
		VALUES ($1, $2, $3, $4, false, '{}', '{}', NOW(), NOW())
		RETURNING id, workspace_id, project_id, name, description, is_default, view_props, logo_props, created_at, updated_at
	`, workspaceID, projectID, name, description)

	return scanIntake(row)
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, intakeID string, payload WritePayload) (any, error) {
	_, err := s.resolveUser(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	var updates []string
	var args []any
	argID := 1

	if payload.Name != nil {
		updates = append(updates, fmt.Sprintf("name = $%d", argID))
		args = append(args, *payload.Name)
		argID++
	}
	if payload.Description != nil {
		updates = append(updates, fmt.Sprintf("description = $%d", argID))
		args = append(args, *payload.Description)
		argID++
	}
	if payload.ViewProps != nil {
		updates = append(updates, fmt.Sprintf("view_props = $%d", argID))
		args = append(args, *payload.ViewProps)
		argID++
	}
	if payload.LogoProps != nil {
		updates = append(updates, fmt.Sprintf("logo_props = $%d", argID))
		args = append(args, *payload.LogoProps)
		argID++
	}
	if payload.IsDefault != nil {
		updates = append(updates, fmt.Sprintf("is_default = $%d", argID))
		args = append(args, *payload.IsDefault)
		argID++
	}

	if len(updates) == 0 {
		return s.GetForSession(ctx, sessionKey, slug, projectID, intakeID)
	}

	updates = append(updates, "updated_at = NOW()")
	query := fmt.Sprintf(`
		UPDATE intakes SET %s
		WHERE id=$%d AND project_id=$%d AND deleted_at IS NULL
		RETURNING id, workspace_id, project_id, name, description, is_default, view_props, logo_props, created_at, updated_at
	`, strings.Join(updates, ", "), argID, argID+1)
	
	args = append(args, intakeID, projectID)

	row := s.Pool.QueryRow(ctx, query, args...)
	item, err := scanIntake(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, intakeID string) error {
	_, err := s.resolveUser(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}

	var isDefault bool
	err = s.Pool.QueryRow(ctx, `SELECT is_default FROM intakes WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL`, intakeID, projectID).Scan(&isDefault)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if isDefault {
		return errors.New("You cannot delete the default intake")
	}

	_, err = s.Pool.Exec(ctx, `UPDATE intakes SET deleted_at=NOW() WHERE id=$1`, intakeID)
	return err
}
