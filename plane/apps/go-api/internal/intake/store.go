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

func (s PostgreSQLStore) ListPublic(ctx context.Context, projectID, intakeID string) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT i.id, i.name, i.description_html, i.priority, i.project_id, i.workspace_id, i.state_id, i.created_at, i.updated_at, i.created_by_id, i.updated_by_id, 
			ii.id AS bridge_id, ii.status AS bridge_status, ii.snoozed_till AS bridge_snoozed_till, ii.duplicate_to_id AS bridge_duplicate_to, ii.source AS bridge_source
		FROM issues i
		JOIN intake_issues ii ON i.id = ii.issue_id
		WHERE ii.intake_id = $1 AND ii.project_id = $2 AND ii.deleted_at IS NULL AND i.deleted_at IS NULL
		ORDER BY ii.snoozed_till ASC NULLS FIRST, ii.status ASC
	`, intakeID, projectID)
	if err != nil {
		return nil, fmt.Errorf("list public intake issues: %w", err)
	}
	defer rows.Close()

	var issues []map[string]any
	for rows.Next() {
		var id, name, description_html, priority, project_id, workspace_id, state_id string
		var created_at, updated_at time.Time
		var created_by_id, updated_by_id, bridge_duplicate_to, bridge_source *string
		var bridge_id string
		var bridge_status int
		var bridge_snoozed_till *time.Time

		if err := rows.Scan(&id, &name, &description_html, &priority, &project_id, &workspace_id, &state_id, &created_at, &updated_at, &created_by_id, &updated_by_id,
			&bridge_id, &bridge_status, &bridge_snoozed_till, &bridge_duplicate_to, &bridge_source); err != nil {
			return nil, fmt.Errorf("scan intake issue: %w", err)
		}

		issue := map[string]any{
			"id":               id,
			"name":             name,
			"description_html": description_html,
			"priority":         priority,
			"project":          project_id,
			"workspace":        workspace_id,
			"state":            state_id,
			"created_at":       created_at,
			"updated_at":       updated_at,
			"created_by":       created_by_id,
			"updated_by":       updated_by_id,
			"issue_intake": map[string]any{
				"id":           bridge_id,
				"status":       bridge_status,
				"snoozed_till": bridge_snoozed_till,
				"duplicate_to": bridge_duplicate_to,
				"source":       bridge_source,
			},
		}
		issues = append(issues, issue)
	}
	return issues, rows.Err()
}

func (s PostgreSQLStore) GetPublic(ctx context.Context, projectID, intakeID, pk string) (map[string]any, error) {
	row := s.Pool.QueryRow(ctx, `
		SELECT i.id, i.name, i.description_html, i.priority, i.project_id, i.workspace_id, i.state_id, i.created_at, i.updated_at, i.created_by_id, i.updated_by_id, 
			ii.id AS bridge_id, ii.status AS bridge_status, ii.snoozed_till AS bridge_snoozed_till, ii.duplicate_to_id AS bridge_duplicate_to, ii.source AS bridge_source
		FROM issues i
		JOIN intake_issues ii ON i.id = ii.issue_id
		WHERE ii.id = $1 AND ii.intake_id = $2 AND ii.project_id = $3 AND ii.deleted_at IS NULL AND i.deleted_at IS NULL
	`, pk, intakeID, projectID)

	var id, name, description_html, priority, project_id, workspace_id, state_id string
	var created_at, updated_at time.Time
	var created_by_id, updated_by_id, bridge_duplicate_to, bridge_source *string
	var bridge_id string
	var bridge_status int
	var bridge_snoozed_till *time.Time

	if err := row.Scan(&id, &name, &description_html, &priority, &project_id, &workspace_id, &state_id, &created_at, &updated_at, &created_by_id, &updated_by_id,
		&bridge_id, &bridge_status, &bridge_snoozed_till, &bridge_duplicate_to, &bridge_source); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan intake issue: %w", err)
	}

	return map[string]any{
		"id":               id,
		"name":             name,
		"description_html": description_html,
		"priority":         priority,
		"project":          project_id,
		"workspace":        workspace_id,
		"state":            state_id,
		"created_at":       created_at,
		"updated_at":       updated_at,
		"created_by":       created_by_id,
		"updated_by":       updated_by_id,
		"issue_intake": map[string]any{
			"id":           bridge_id,
			"status":       bridge_status,
			"snoozed_till": bridge_snoozed_till,
			"duplicate_to": bridge_duplicate_to,
			"source":       bridge_source,
		},
	}, nil
}

func (s PostgreSQLStore) CreatePublic(ctx context.Context, projectID, intakeID, workspaceID string, issueData map[string]any, userID *string) (map[string]any, error) {
	name, _ := issueData["name"].(string)
	if name == "" {
		return nil, errors.New("name is required")
	}
	priority, _ := issueData["priority"].(string)
	if priority == "" {
		priority = "low"
	}
	descriptionHtml, _ := issueData["description_html"].(string)
	if descriptionHtml == "" {
		descriptionHtml = "<p></p>"
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Get or Create Triage state
	var stateID string
	err = tx.QueryRow(ctx, `SELECT id FROM states WHERE project_id=$1 AND workspace_id=$2 AND "group"='triage' AND deleted_at IS NULL LIMIT 1`, projectID, workspaceID).Scan(&stateID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `INSERT INTO states (name, "group", project_id, workspace_id, color, sequence, is_default, created_at, updated_at)
			VALUES ('Triage', 'triage', $1, $2, '#4E5355', 65000, false, NOW(), NOW()) RETURNING id`, projectID, workspaceID).Scan(&stateID)
	}
	if err != nil {
		return nil, fmt.Errorf("triage state: %w", err)
	}

	// Create Issue
	var issueID string
	err = tx.QueryRow(ctx, `INSERT INTO issues (name, description_html, priority, project_id, workspace_id, state_id, created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7, NOW(), NOW()) RETURNING id`, name, descriptionHtml, priority, projectID, workspaceID, stateID, userID).Scan(&issueID)
	if err != nil {
		return nil, fmt.Errorf("create issue: %w", err)
	}

	// Create IntakeIssue
	var bridgeID string
	err = tx.QueryRow(ctx, `INSERT INTO intake_issues (intake_id, issue_id, project_id, workspace_id, status, source, created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 1, 'in-app', $5, $5, NOW(), NOW()) RETURNING id`, intakeID, issueID, projectID, workspaceID, userID).Scan(&bridgeID)
	if err != nil {
		return nil, fmt.Errorf("create intake issue: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return s.GetPublic(ctx, projectID, intakeID, bridgeID)
}

func (s PostgreSQLStore) UpdatePublic(ctx context.Context, projectID, intakeID, pk string, issueData map[string]any, userID *string) (map[string]any, error) {
	// First verify ownership
	var createdBy *string
	var issueID string
	err := s.Pool.QueryRow(ctx, `SELECT created_by_id, issue_id FROM intake_issues WHERE id=$1 AND intake_id=$2 AND project_id=$3 AND deleted_at IS NULL`, pk, intakeID, projectID).Scan(&createdBy, &issueID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	if userID == nil || createdBy == nil || *userID != *createdBy {
		return nil, errors.New("you cannot edit intake issues")
	}

	var updates []string
	var args []any
	argID := 1

	if name, ok := issueData["name"].(string); ok {
		updates = append(updates, fmt.Sprintf("name = $%d", argID))
		args = append(args, name)
		argID++
	}
	if desc, ok := issueData["description_html"].(string); ok {
		updates = append(updates, fmt.Sprintf("description_html = $%d", argID))
		args = append(args, desc)
		argID++
	}

	if len(updates) > 0 {
		updates = append(updates, "updated_at = NOW()")
		if userID != nil {
			updates = append(updates, fmt.Sprintf("updated_by_id = $%d", argID))
			args = append(args, *userID)
			argID++
		}
		args = append(args, issueID)
		_, err = s.Pool.Exec(ctx, fmt.Sprintf(`UPDATE issues SET %s WHERE id = $%d`, strings.Join(updates, ", "), argID), args...)
		if err != nil {
			return nil, fmt.Errorf("update issue: %w", err)
		}
	}

	return s.GetPublic(ctx, projectID, intakeID, pk)
}

func (s PostgreSQLStore) DeletePublic(ctx context.Context, projectID, intakeID, pk string, userID *string) error {
	var createdBy *string
	err := s.Pool.QueryRow(ctx, `SELECT created_by_id FROM intake_issues WHERE id=$1 AND intake_id=$2 AND project_id=$3 AND deleted_at IS NULL`, pk, intakeID, projectID).Scan(&createdBy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}

	if userID == nil || createdBy == nil || *userID != *createdBy {
		return errors.New("you cannot delete intake issue")
	}

	_, err = s.Pool.Exec(ctx, `UPDATE intake_issues SET deleted_at=NOW() WHERE id=$1`, pk)
	return err
}
