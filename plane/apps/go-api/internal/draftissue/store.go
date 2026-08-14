package draftissue

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/makeplane/plane/apps/go-api/internal/issue"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("draft issue not found")
)

type Item struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	DescriptionHTML string     `json:"description_html,omitempty"`
	SortOrder       float64    `json:"sort_order"`
	StateID         *string    `json:"state_id"`
	Priority        string     `json:"priority"`
	LabelIDs        []string   `json:"label_ids"`
	AssigneeIDs     []string   `json:"assignee_ids"`
	EstimatePoint   *string    `json:"estimate_point"`
	ProjectID       string     `json:"project_id"`
	ParentID        *string    `json:"parent_id"`
	CycleID         *string    `json:"cycle_id"`
	ModuleIDs       []string   `json:"module_ids"`
	TypeID          *string    `json:"type_id"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	StartDate       *time.Time `json:"start_date"`
	TargetDate      *time.Time `json:"target_date"`
	CompletedAt     *time.Time `json:"completed_at"`
	CreatedBy       *string    `json:"created_by"`
	UpdatedBy       *string    `json:"updated_by"`

	// Expansions
	State     any `json:"state,omitempty"`
	Assignees any `json:"assignees,omitempty"`
	Labels    any `json:"labels,omitempty"`
	Parent    any `json:"parent,omitempty"`
}

type Page struct {
	TotalCount int    `json:"total_count"`
	NextCursor string `json:"next_cursor"`
	PrevCursor string `json:"prev_cursor"`
	NextPage   bool   `json:"next_page_results"`
	PrevPage   bool   `json:"prev_page_results"`
	Count      int    `json:"count"`
	TotalPages int    `json:"total_pages"`
	ExtraStats any    `json:"extra_stats"`
	Results    []Item `json:"results"`
}

type Filter struct {
	Limit  int
	Offset int
}

type IssueTxCreator interface {
	CreateForSessionTx(ctx context.Context, tx pgx.Tx, sessionKey, slug, projectID string, input issue.WritePayload) (issue.Item, error)
}

type PostgreSQLStore struct {
	Pool           *pgxpool.Pool
	IssueTxCreator IssueTxCreator
}

func (s PostgreSQLStore) authorize(ctx context.Context, sessionKey, slug string) (string, error) {
	if s.Pool == nil {
		return "", errors.New("draft issue database unavailable")
	}
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var workspaceID string
	err := s.Pool.QueryRow(ctx, `SELECT w.id::text FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id::text=s.user_id
			AND wm.is_active=TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug).Scan(&workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		var valid bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); checkErr != nil {
			return "", fmt.Errorf("check session: %w", checkErr)
		}
		if valid {
			return "", ErrForbidden
		}
		return "", ErrUnauthorized
	}
	if err != nil {
		return "", fmt.Errorf("check workspace member: %w", err)
	}
	return workspaceID, nil
}

func (s PostgreSQLStore) authorizeAndGetUserID(ctx context.Context, sessionKey, slug string) (string, string, error) {
	if s.Pool == nil {
		return "", "", errors.New("draft issue database unavailable")
	}
	if sessionKey == "" {
		return "", "", ErrUnauthorized
	}
	var workspaceID, userID string
	err := s.Pool.QueryRow(ctx, `SELECT w.id::text, s.user_id FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id::text=s.user_id
			AND wm.is_active=TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug).Scan(&workspaceID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		var valid bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); checkErr != nil {
			return "", "", fmt.Errorf("check session: %w", checkErr)
		}
		if valid {
			return "", "", ErrForbidden
		}
		return "", "", ErrUnauthorized
	}
	if err != nil {
		return "", "", fmt.Errorf("check workspace member: %w", err)
	}
	return workspaceID, userID, nil
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string, filter Filter) (Page, error) {
	workspaceID, userID, err := s.authorizeAndGetUserID(ctx, sessionKey, slug)
	if err != nil {
		return Page{}, err
	}

	baseQuery := ` FROM draft_issues WHERE workspace_id::text=$1 AND created_by_id::text=$2 AND deleted_at IS NULL`
	args := []any{workspaceID, userID}

	var total int
	if err := s.Pool.QueryRow(ctx, `SELECT COUNT(*)`+baseQuery, args...).Scan(&total); err != nil {
		return Page{}, fmt.Errorf("count draft issues: %w", err)
	}

	query := `SELECT id::text FROM draft_issues WHERE workspace_id::text=$1 AND created_by_id::text=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $3 OFFSET $4`
	args = append(args, filter.Limit, filter.Offset)

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return Page{}, fmt.Errorf("list draft issues: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return Page{}, err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		return Page{}, err
	}

	var items []Item
	if len(ids) > 0 {
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return Page{}, err
		}
		defer tx.Rollback(ctx)
		
		for _, id := range ids {
			item, err := readItem(ctx, tx, id)
			if err != nil {
				return Page{}, err
			}
			items = append(items, item)
		}
	}

	return makePage(items, total, filter.Limit, filter.Offset), nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, draftID string) (Item, error) {
	workspaceID, userID, err := s.authorizeAndGetUserID(ctx, sessionKey, slug)
	if err != nil {
		return Item{}, err
	}

	var exists bool
	if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM draft_issues WHERE id::text=$1 AND workspace_id::text=$2 AND created_by_id::text=$3 AND deleted_at IS NULL)`, draftID, workspaceID, userID).Scan(&exists); err != nil {
		return Item{}, err
	}
	if !exists {
		return Item{}, ErrNotFound
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)

	return readItem(ctx, tx, draftID)
}

func makePage(items []Item, total, limit, offset int) Page {
	if items == nil {
		items = []Item{}
	}
	nextOffset := offset + len(items)
	prevOffset := offset - limit
	if prevOffset < 0 {
		prevOffset = 0
	}
	totalPages := 0
	if limit > 0 {
		totalPages = total / limit
		if total%limit > 0 {
			totalPages++
		}
	}
	hasNext := nextOffset < total
	hasPrev := offset > 0
	return Page{
		TotalCount: total,
		NextPage:   hasNext,
		PrevPage:   hasPrev,
		Count:      len(items),
		TotalPages: totalPages,
		NextCursor: fmt.Sprintf("%d,0,0", nextOffset),
		PrevCursor: fmt.Sprintf("%d,0,0", prevOffset),
		Results:    items,
	}
}

func (s PostgreSQLStore) TransferFileAssets(ctx context.Context, draftID, issueID string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE file_assets SET issue_id=$2::uuid, entity_type='ISSUE_DESCRIPTION', draft_issue_id=NULL WHERE draft_issue_id::text=$1`, draftID, issueID)
	return err
}

func (s PostgreSQLStore) DraftToIssue(ctx context.Context, sessionKey, slug, draftID string, payload issue.WritePayload) (issue.Item, error) {
	if s.IssueTxCreator == nil {
		return issue.Item{}, errors.New("issue tx creator not configured")
	}

	workspaceID, userID, err := s.authorizeAndGetUserID(ctx, sessionKey, slug)
	if err != nil {
		return issue.Item{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return issue.Item{}, fmt.Errorf("begin draft-to-issue: %w", err)
	}
	defer tx.Rollback(ctx)

	// Verify draft exists and get projectID
	var projectID string
	err = tx.QueryRow(ctx, `SELECT project_id::text FROM draft_issues WHERE id::text=$1 AND workspace_id::text=$2 AND created_by_id::text=$3 AND deleted_at IS NULL`, draftID, workspaceID, userID).Scan(&projectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return issue.Item{}, ErrNotFound
	}
	if err != nil {
		return issue.Item{}, fmt.Errorf("read draft issue: %w", err)
	}

	// 1. Create issue using tx
	createdIssue, err := s.IssueTxCreator.CreateForSessionTx(ctx, tx, sessionKey, slug, projectID, payload)
	if err != nil {
		return issue.Item{}, err // error is already formatted by issue store
	}

	// 2. Transfer file assets in tx
	_, err = tx.Exec(ctx, `UPDATE file_assets SET issue_id=$2::uuid, entity_type='ISSUE_DESCRIPTION', draft_issue_id=NULL WHERE draft_issue_id::text=$1`, draftID, createdIssue.ID)
	if err != nil {
		return issue.Item{}, fmt.Errorf("transfer file assets: %w", err)
	}

	// 3. Delete draft in tx
	_, err = tx.Exec(ctx, `UPDATE draft_issues SET deleted_at=NOW() WHERE id::text=$1`, draftID)
	if err != nil {
		return issue.Item{}, fmt.Errorf("delete draft issue: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return issue.Item{}, fmt.Errorf("commit draft-to-issue: %w", err)
	}

	return createdIssue, nil
}
