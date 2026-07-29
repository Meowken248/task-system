package intake

import (
	"context"
	"time"

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

type Store interface {
	ListIntakes(ctx context.Context, projectID string) ([]Intake, error)
	ListIntakeIssues(ctx context.Context, intakeID string) ([]IntakeIssue, error)
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) ListIntakes(ctx context.Context, projectID string) ([]Intake, error) {
	query := `
		SELECT id, workspace_id, project_id, name, description, is_default, view_props, logo_props, created_at, updated_at
		FROM intakes
		WHERE project_id = $1 AND deleted_at IS NULL
		ORDER BY name ASC
	`
	rows, err := s.Pool.Query(ctx, query, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Intake
	for rows.Next() {
		var i Intake
		err := rows.Scan(
			&i.ID, &i.WorkspaceID, &i.ProjectID, &i.Name, &i.Description,
			&i.IsDefault, &i.ViewProps, &i.LogoProps, &i.CreatedAt, &i.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, i)
	}
	if results == nil {
		results = []Intake{}
	}
	return results, nil
}

func (s PostgreSQLStore) ListIntakeIssues(ctx context.Context, intakeID string) ([]IntakeIssue, error) {
	query := `
		SELECT id, workspace_id, project_id, intake_id, issue_id, status, snoozed_till,
		       duplicate_to_id, source, source_email, external_source, external_id, extra,
		       created_at, updated_at
		FROM intake_issues
		WHERE intake_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC
	`
	rows, err := s.Pool.Query(ctx, query, intakeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []IntakeIssue
	for rows.Next() {
		var ii IntakeIssue
		err := rows.Scan(
			&ii.ID, &ii.WorkspaceID, &ii.ProjectID, &ii.IntakeID, &ii.IssueID, &ii.Status,
			&ii.SnoozedTill, &ii.DuplicateToID, &ii.Source, &ii.SourceEmail, &ii.ExternalSource,
			&ii.ExternalID, &ii.Extra, &ii.CreatedAt, &ii.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, ii)
	}
	if results == nil {
		results = []IntakeIssue{}
	}
	return results, nil
}
