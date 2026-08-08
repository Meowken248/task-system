package intake

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
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

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]Intake, error) {
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM sessions session
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN project_members pm ON pm.project_id::text=$3 AND pm.member_id=NULLIF(session.user_id, '')::uuid
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE session.session_key=$1 AND session.expire_date>NOW()
	)`, sessionKey, slug, projectID).Scan(&allowed)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrForbidden
	}
	rows, err := s.Pool.Query(ctx, `SELECT id,workspace_id,project_id,name,description,is_default,view_props,logo_props,created_at,updated_at
		FROM intakes WHERE project_id=$1 AND deleted_at IS NULL ORDER BY name ASC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Intake, 0)
	for rows.Next() {
		var i Intake
		if err := rows.Scan(&i.ID, &i.WorkspaceID, &i.ProjectID, &i.Name, &i.Description, &i.IsDefault, &i.ViewProps, &i.LogoProps, &i.CreatedAt, &i.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	return items, rows.Err()
}
