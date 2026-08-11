package module

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ModuleIssueItem struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace"`
	ProjectID   string    `json:"project"`
	ModuleID    string    `json:"module"`
	IssueID     string    `json:"issue"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	CreatedBy   string    `json:"created_by"`
	UpdatedBy   string    `json:"updated_by"`
}

type ModuleIssueWritePayload struct {
	Issues []string `json:"issues"`
}

type ModuleIssueStore interface {
	List(ctx context.Context, sessionKey, slug, projectID, moduleID string) ([]map[string]any, error)
	Create(ctx context.Context, sessionKey, slug, projectID, moduleID string, payload ModuleIssueWritePayload) ([]ModuleIssueItem, error)
	Delete(ctx context.Context, sessionKey, slug, projectID, moduleID, issueID string) error
}

type PostgreSQLModuleIssueStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLModuleIssueStore) authorize(ctx context.Context, sessionKey, slug, projectID string) (string, error) {
	if s.Pool == nil {
		return "", errors.New("module issue database unavailable")
	}
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN project_projectmember pm ON pm.member_id=s.user_id AND pm.workspace_id=w.id AND pm.project_id=$3 AND pm.is_active=true AND pm.deleted_at IS NULL
		WHERE s.session_key=$1`, sessionKey, slug, projectID).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrForbidden
		}
		return "", fmt.Errorf("authorize module issue: %w", err)
	}
	return userID, nil
}

func (s PostgreSQLModuleIssueStore) List(ctx context.Context, sessionKey, slug, projectID, moduleID string) ([]map[string]any, error) {
	_, err := s.authorize(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			i.id, i.sequence_id, i.name, i.description_html, i.sort_order, i.state_id, i.priority,
			i.estimate_point, i.project_id, i.parent_id, i.type_id, i.created_at, i.updated_at,
			i.start_date, i.target_date, i.completed_at, i.archived_at, i.created_by_id, i.updated_by_id, i.is_draft,
			mi.id as bridge_id,
			(SELECT COUNT(*) FROM issues child WHERE child.parent_id=i.id AND child.deleted_at IS NULL) as sub_issues_count,
			(SELECT COUNT(*) FROM file_assets fa WHERE fa.issue_id=i.id AND fa.entity_type='ISSUE_ATTACHMENT' AND fa.deleted_at IS NULL) as attachment_count,
			(SELECT COUNT(*) FROM issue_links il WHERE il.issue_id=i.id AND il.deleted_at IS NULL) as link_count,
			COALESCE(ARRAY(SELECT label_id FROM issue_labels il WHERE il.issue_id=i.id AND il.deleted_at IS NULL), ARRAY[]::uuid[]) as label_ids,
			COALESCE(ARRAY(SELECT assignee_id FROM issue_assignees ia WHERE ia.issue_id=i.id AND ia.deleted_at IS NULL), ARRAY[]::uuid[]) as assignee_ids
		FROM issues i
		JOIN module_issues mi ON mi.issue_id = i.id AND mi.module_id = $1 AND mi.deleted_at IS NULL
		WHERE i.project_id = $2 AND i.deleted_at IS NULL
		ORDER BY i.created_at DESC
	`
	rows, err := s.Pool.Query(ctx, query, moduleID, projectID)
	if err != nil {
		return nil, fmt.Errorf("query module issues: %w", err)
	}
	defer rows.Close()

	var issues []map[string]any
	for rows.Next() {
		var id, name, priority, project, createdBy, updatedBy string
		var bridgeID string
		var sequenceID, subIssuesCount, attachmentCount, linkCount int
		var sortOrder float64
		var stateID, descriptionHTML, estimatePoint, parentID, typeID *string
		var createdAt, updatedAt time.Time
		var startDate, targetDate, completedAt, archivedAt *time.Time
		var isDraft bool
		var labelIDs, assigneeIDs []string

		err := rows.Scan(
			&id, &sequenceID, &name, &descriptionHTML, &sortOrder, &stateID, &priority,
			&estimatePoint, &project, &parentID, &typeID, &createdAt, &updatedAt,
			&startDate, &targetDate, &completedAt, &archivedAt, &createdBy, &updatedBy, &isDraft,
			&bridgeID, &subIssuesCount, &attachmentCount, &linkCount, &labelIDs, &assigneeIDs,
		)
		if err != nil {
			return nil, fmt.Errorf("scan module issue: %w", err)
		}

		issue := map[string]any{
			"id":               id,
			"sequence_id":      sequenceID,
			"name":             name,
			"description_html": descriptionHTML,
			"sort_order":       sortOrder,
			"state_id":         stateID,
			"priority":         priority,
			"estimate_point":   estimatePoint,
			"project_id":       project,
			"parent_id":        parentID,
			"module_id":        moduleID,
			"type_id":          typeID,
			"created_at":       createdAt,
			"updated_at":       updatedAt,
			"start_date":       startDate,
			"target_date":      targetDate,
			"completed_at":     completedAt,
			"archived_at":      archivedAt,
			"created_by":       createdBy,
			"updated_by":       updatedBy,
			"is_draft":         isDraft,
			"bridge_id":        bridgeID,
			"sub_issues_count": subIssuesCount,
			"attachment_count": attachmentCount,
			"link_count":       linkCount,
			"label_ids":        labelIDs,
			"assignee_ids":     assigneeIDs,
		}
		issues = append(issues, issue)
	}
	if issues == nil {
		issues = make([]map[string]any, 0)
	}
	return issues, nil
}

func (s PostgreSQLModuleIssueStore) Create(ctx context.Context, sessionKey, slug, projectID, moduleID string, payload ModuleIssueWritePayload) ([]ModuleIssueItem, error) {
	userID, err := s.authorize(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}
	if len(payload.Issues) == 0 {
		return nil, ErrInvalid
	}

	var workspaceID string
	err = s.Pool.QueryRow(ctx, "SELECT workspace_id FROM projects WHERE id=$1 AND deleted_at IS NULL", projectID).Scan(&workspaceID)
	if err != nil {
		return nil, fmt.Errorf("get workspace: %w", err)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin module issue tx: %w", err)
	}
	defer tx.Rollback(ctx)

	now := time.Now().UTC()
	var createdItems []ModuleIssueItem

	// Django logic: For ModuleIssue, it creates a new record for each issue if it doesn't already exist for that module
	for _, issueID := range payload.Issues {
		var existingID string
		err := tx.QueryRow(ctx, "SELECT id FROM module_issues WHERE issue_id=$1 AND module_id=$2 AND deleted_at IS NULL", issueID, moduleID).Scan(&existingID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("check existing module issue: %w", err)
		}

		if existingID != "" {
			// Already exists, just touch it
			_, err = tx.Exec(ctx, "UPDATE module_issues SET updated_at=$1, updated_by_id=$2 WHERE id=$3",
				now, userID, existingID)
			if err != nil {
				return nil, fmt.Errorf("update module issue: %w", err)
			}
		} else {
			b := make([]byte, 16)
			rand.Read(b)
			newID := hex.EncodeToString(b)
			newID = newID[:8] + "-" + newID[8:12] + "-4" + newID[13:16] + "-a" + newID[17:20] + "-" + newID[20:]

			_, err = tx.Exec(ctx, `
				INSERT INTO module_issues (id, workspace_id, project_id, module_id, issue_id, created_at, updated_at, created_by_id, updated_by_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				newID, workspaceID, projectID, moduleID, issueID, now, now, userID, userID)
			if err != nil {
				return nil, fmt.Errorf("insert module issue: %w", err)
			}

			createdItems = append(createdItems, ModuleIssueItem{
				ID:          newID,
				WorkspaceID: workspaceID,
				ProjectID:   projectID,
				ModuleID:    moduleID,
				IssueID:     issueID,
				CreatedAt:   now,
				UpdatedAt:   now,
				CreatedBy:   userID,
				UpdatedBy:   userID,
			})
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit module issue tx: %w", err)
	}

	return createdItems, nil
}

func (s PostgreSQLModuleIssueStore) Delete(ctx context.Context, sessionKey, slug, projectID, moduleID, issueID string) error {
	userID, err := s.authorize(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}

	cmd, err := s.Pool.Exec(ctx, `
		UPDATE module_issues
		SET deleted_at=$1, updated_by_id=$2, updated_at=$1
		WHERE module_id=$3 AND issue_id=$4 AND deleted_at IS NULL
	`, time.Now().UTC(), userID, moduleID, issueID)
	if err != nil {
		return fmt.Errorf("delete module issue: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
