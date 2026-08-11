package activity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
)

// Activity represents a single activity entry from issue_activities.
type Activity struct {
	ID             string    `json:"id"`
	IssueID        *string   `json:"issue"`
	Verb           string    `json:"verb"`
	Field          *string   `json:"field"`
	OldValue       *string   `json:"old_value"`
	NewValue       *string   `json:"new_value"`
	Comment        string    `json:"comment"`
	Attachments    []string  `json:"attachments"`
	IssueCommentID *string   `json:"issue_comment"`
	ActorID        *string   `json:"actor"`
	OldIdentifier  *string   `json:"old_identifier"`
	NewIdentifier  *string   `json:"new_identifier"`
	Epoch          *float64  `json:"epoch"`
	ProjectID      string    `json:"project"`
	WorkspaceID    string    `json:"workspace"`
	CreatedBy      *string   `json:"created_by"`
	UpdatedBy      *string   `json:"updated_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// CommentEntry represents a comment in the combined activity timeline.
type CommentEntry struct {
	ID              string          `json:"id"`
	CommentStripped string          `json:"comment_stripped"`
	CommentJSON     json.RawMessage `json:"comment_json"`
	CommentHTML     string          `json:"comment_html"`
	Attachments     []string        `json:"attachments"`
	Access          string          `json:"access"`
	ExternalSource  *string         `json:"external_source"`
	ExternalID      *string         `json:"external_id"`
	EditedAt        *time.Time      `json:"edited_at"`
	ParentID        *string         `json:"parent_id"`
	IssueID         string          `json:"issue"`
	ActorID         *string         `json:"actor"`
	ProjectID       string          `json:"project"`
	WorkspaceID     string          `json:"workspace"`
	CreatedBy       *string         `json:"created_by"`
	UpdatedBy       *string         `json:"updated_by"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// PostgreSQLStore reads activities and comments for the history timeline.
type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) authorize(ctx context.Context, sessionKey, slug, projectID string) (string, error) {
	if s.Pool == nil {
		return "", errors.New("activity database unavailable")
	}
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug, projectID).Scan(&userID)
	if err != nil {
		var validSession bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&validSession); checkErr != nil {
			return "", fmt.Errorf("check activity session: %w", checkErr)
		}
		if validSession {
			return "", ErrForbidden
		}
		return "", ErrUnauthorized
	}
	return userID, nil
}

// ListForSession returns the issue history/activity timeline.
// activityType can be "issue-property" (activities only), "issue-comment" (comments only),
// or empty (merged timeline sorted by created_at).
func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID, issueID, activityType, createdAtGt string) (any, error) {
	_, err := s.authorize(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	switch activityType {
	case "issue-property", "epic-property":
		return s.listActivities(ctx, projectID, issueID, createdAtGt)
	case "issue-comment", "epic-comment":
		return s.listComments(ctx, projectID, issueID, createdAtGt)
	default:
		return s.listMerged(ctx, projectID, issueID, createdAtGt)
	}
}

func (s PostgreSQLStore) listActivities(ctx context.Context, projectID, issueID, createdAtGt string) ([]Activity, error) {
	filterClause := ""
	args := []any{projectID, issueID}
	if createdAtGt != "" {
		filterClause = " AND a.created_at > $3"
		args = append(args, createdAtGt)
	}
	rows, err := s.Pool.Query(ctx, `SELECT
		a.id::text, a.issue_id::text, a.verb, a.field, a.old_value, a.new_value,
		a.comment, a.attachments, a.issue_comment_id::text, a.actor_id::text,
		a.old_identifier::text, a.new_identifier::text, a.epoch,
		a.project_id::text, a.workspace_id::text,
		a.created_by_id::text, a.updated_by_id::text, a.created_at, a.updated_at
		FROM issue_activities a
		WHERE a.issue_id::text=$2 AND a.project_id::text=$1
		AND a.field NOT IN ('comment','vote','reaction','draft')`+filterClause+`
		ORDER BY a.created_at ASC`, args...)
	if err != nil {
		return nil, fmt.Errorf("list activities: %w", err)
	}
	defer rows.Close()
	activities := make([]Activity, 0, 64)
	for rows.Next() {
		var a Activity
		if scanErr := rows.Scan(&a.ID, &a.IssueID, &a.Verb, &a.Field, &a.OldValue, &a.NewValue,
			&a.Comment, &a.Attachments, &a.IssueCommentID, &a.ActorID,
			&a.OldIdentifier, &a.NewIdentifier, &a.Epoch,
			&a.ProjectID, &a.WorkspaceID,
			&a.CreatedBy, &a.UpdatedBy, &a.CreatedAt, &a.UpdatedAt); scanErr != nil {
			return nil, fmt.Errorf("scan activity: %w", scanErr)
		}
		if a.Attachments == nil {
			a.Attachments = []string{}
		}
		activities = append(activities, a)
	}
	return activities, rows.Err()
}

func (s PostgreSQLStore) listComments(ctx context.Context, projectID, issueID, createdAtGt string) ([]CommentEntry, error) {
	filterClause := ""
	args := []any{projectID, issueID}
	if createdAtGt != "" {
		filterClause = " AND c.created_at > $3"
		args = append(args, createdAtGt)
	}
	rows, err := s.Pool.Query(ctx, `SELECT
		c.id::text, c.comment_stripped, c.comment_json, c.comment_html,
		c.attachments, c.access, c.external_source, c.external_id, c.edited_at,
		c.parent_id::text, c.issue_id::text, c.actor_id::text,
		c.project_id::text, c.workspace_id::text,
		c.created_by_id::text, c.updated_by_id::text, c.created_at, c.updated_at
		FROM issue_comments c
		WHERE c.issue_id::text=$2 AND c.project_id::text=$1 AND c.deleted_at IS NULL`+filterClause+`
		ORDER BY c.created_at ASC`, args...)
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	defer rows.Close()
	comments := make([]CommentEntry, 0, 32)
	for rows.Next() {
		var c CommentEntry
		var commentJSON []byte
		if scanErr := rows.Scan(&c.ID, &c.CommentStripped, &commentJSON, &c.CommentHTML,
			&c.Attachments, &c.Access, &c.ExternalSource, &c.ExternalID, &c.EditedAt,
			&c.ParentID, &c.IssueID, &c.ActorID,
			&c.ProjectID, &c.WorkspaceID,
			&c.CreatedBy, &c.UpdatedBy, &c.CreatedAt, &c.UpdatedAt); scanErr != nil {
			return nil, fmt.Errorf("scan comment: %w", scanErr)
		}
		if commentJSON != nil {
			c.CommentJSON = json.RawMessage(commentJSON)
		} else {
			c.CommentJSON = json.RawMessage(`{}`)
		}
		if c.Attachments == nil {
			c.Attachments = []string{}
		}
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

// timelineEntry wraps either an activity or comment for merge-sort by created_at.
type timelineEntry struct {
	CreatedAt time.Time
	Data      any
}

func (s PostgreSQLStore) listMerged(ctx context.Context, projectID, issueID, createdAtGt string) ([]any, error) {
	activities, err := s.listActivities(ctx, projectID, issueID, createdAtGt)
	if err != nil {
		return nil, err
	}
	comments, err := s.listComments(ctx, projectID, issueID, createdAtGt)
	if err != nil {
		return nil, err
	}
	entries := make([]timelineEntry, 0, len(activities)+len(comments))
	for _, a := range activities {
		entries = append(entries, timelineEntry{CreatedAt: a.CreatedAt, Data: a})
	}
	for _, c := range comments {
		entries = append(entries, timelineEntry{CreatedAt: c.CreatedAt, Data: c})
	}
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].CreatedAt.Before(entries[j].CreatedAt)
	})
	result := make([]any, len(entries))
	for i, e := range entries {
		result[i] = e.Data
	}
	return result, nil
}
