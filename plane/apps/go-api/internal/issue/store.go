package issue

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("work item not found")
)

type Item struct {
	ID              string     `json:"id"`
	SequenceID      int        `json:"sequence_id"`
	Name            string     `json:"name"`
	DescriptionHTML string     `json:"description_html,omitempty"`
	SortOrder       float64    `json:"sort_order"`
	StateID         *string    `json:"state_id"`
	Priority        string     `json:"priority"`
	LabelIDs        []string   `json:"label_ids"`
	AssigneeIDs     []string   `json:"assignee_ids"`
	EstimatePoint   *string    `json:"estimate_point"`
	SubIssuesCount  int        `json:"sub_issues_count"`
	AttachmentCount int        `json:"attachment_count"`
	LinkCount       int        `json:"link_count"`
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
	ArchivedAt      *time.Time `json:"archived_at"`
	CreatedBy       *string    `json:"created_by"`
	UpdatedBy       *string    `json:"updated_by"`
	IsDraft         bool       `json:"is_draft"`

	// Expansions
	State            any `json:"state,omitempty"`
	Assignees        any `json:"assignees,omitempty"`
	Labels           any `json:"labels,omitempty"`
	IssueReactions   any `json:"issue_reactions,omitempty"`
	IssueRelation    any `json:"issue_relation,omitempty"`
	IssueRelated     any `json:"issue_related,omitempty"`
	IssueAttachments any `json:"issue_attachments,omitempty"`
	IssueLink        any `json:"issue_link,omitempty"`
	Parent           any `json:"parent,omitempty"`
}

type Page struct {
	GroupedBy    any    `json:"grouped_by"`
	SubGroupedBy any    `json:"sub_grouped_by"`
	TotalCount   int    `json:"total_count"`
	NextCursor   string `json:"next_cursor"`
	PrevCursor   string `json:"prev_cursor"`
	NextPage     bool   `json:"next_page_results"`
	PrevPage     bool   `json:"prev_page_results"`
	Count        int    `json:"count"`
	TotalPages   int    `json:"total_pages"`
	ExtraStats   any    `json:"extra_stats"`
	Results      []Item `json:"results"`
}

type IssueFilter struct {
	Limit      int
	Offset     int
	State      string
	StateGroup string
	Priority   string
	Labels     string
	Assignees  string
	CreatedBy  string
	OrderBy    string
	GroupBy    string
	SubGroupBy string
	Expand     string
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) authorize(ctx context.Context, sessionKey, slug, projectID string) error {
	if s.Pool == nil {
		return errors.New("work item database unavailable")
	}
	if sessionKey == "" {
		return ErrUnauthorized
	}
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW())`, sessionKey, slug, projectID).Scan(&allowed)
	if err != nil {
		return fmt.Errorf("resolve work item access: %w", err)
	}
	if allowed {
		return nil
	}
	var validSession bool
	if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&validSession); err != nil {
		return fmt.Errorf("check work item session: %w", err)
	}
	if validSession {
		return ErrForbidden
	}
	return ErrUnauthorized
}

const itemColumns = `i.id::text, i.sequence_id, i.name, i.description_html, i.sort_order,
	i.state_id::text, i.priority,
	ARRAY(SELECT ia.assignee_id::text FROM issue_assignees ia WHERE ia.issue_id=i.id AND ia.deleted_at IS NULL ORDER BY ia.created_at),
	ARRAY(SELECT il.label_id::text FROM issue_labels il WHERE il.issue_id=i.id AND il.deleted_at IS NULL ORDER BY il.created_at),
	i.estimate_point_id::text,
	(SELECT COUNT(*)::int FROM issues child WHERE child.parent_id=i.id AND child.deleted_at IS NULL AND child.archived_at IS NULL AND child.is_draft=FALSE),
	(SELECT COUNT(*)::int FROM file_assets fa WHERE fa.issue_id=i.id AND fa.deleted_at IS NULL),
	(SELECT COUNT(*)::int FROM issue_links link WHERE link.issue_id=i.id AND link.deleted_at IS NULL),
	i.project_id::text, i.parent_id::text,
	(SELECT ci.cycle_id::text FROM cycle_issues ci WHERE ci.issue_id=i.id AND ci.deleted_at IS NULL ORDER BY ci.created_at LIMIT 1),
	ARRAY(SELECT mi.module_id::text FROM module_issues mi WHERE mi.issue_id=i.id AND mi.deleted_at IS NULL ORDER BY mi.created_at),
	i.type_id::text, i.created_at, i.updated_at, i.start_date, i.target_date, i.completed_at, i.archived_at,
	i.created_by_id::text, i.updated_by_id::text, i.is_draft`

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string, filter IssueFilter) (Page, error) {
	if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
		return Page{}, err
	}

	baseQuery := ` FROM issues i JOIN states st ON st.id=i.state_id WHERE i.project_id::text=$1 AND i.deleted_at IS NULL AND i.archived_at IS NULL AND i.is_draft=FALSE AND st."group" <> 'triage'`
	args := []any{projectID}
	argIdx := 2

	if filter.State != "" && filter.State != "null" {
		baseQuery += fmt.Sprintf(` AND i.state_id::text = ANY(string_to_array($%d, ','))`, argIdx)
		args = append(args, filter.State)
		argIdx++
	}
	if filter.StateGroup != "" && filter.StateGroup != "null" {
		baseQuery += fmt.Sprintf(` AND st."group" = ANY(string_to_array($%d, ','))`, argIdx)
		args = append(args, filter.StateGroup)
		argIdx++
	}
	if filter.Priority != "" && filter.Priority != "null" {
		baseQuery += fmt.Sprintf(` AND i.priority = ANY(string_to_array($%d, ','))`, argIdx)
		args = append(args, filter.Priority)
		argIdx++
	}
	if filter.Labels != "" && filter.Labels != "null" {
		baseQuery += fmt.Sprintf(` AND EXISTS(SELECT 1 FROM issue_labels il WHERE il.issue_id=i.id AND il.label_id::text = ANY(string_to_array($%d, ',')) AND il.deleted_at IS NULL)`, argIdx)
		args = append(args, filter.Labels)
		argIdx++
	}
	if filter.Assignees != "" && filter.Assignees != "null" {
		baseQuery += fmt.Sprintf(` AND EXISTS(SELECT 1 FROM issue_assignees ia WHERE ia.issue_id=i.id AND ia.assignee_id::text = ANY(string_to_array($%d, ',')) AND ia.deleted_at IS NULL)`, argIdx)
		args = append(args, filter.Assignees)
		argIdx++
	}
	if filter.CreatedBy != "" && filter.CreatedBy != "null" {
		baseQuery += fmt.Sprintf(` AND i.created_by_id::text = ANY(string_to_array($%d, ','))`, argIdx)
		args = append(args, filter.CreatedBy)
		argIdx++
	}

	orderBy := "ORDER BY i.created_at DESC"
	if filter.OrderBy == "created_at" {
		orderBy = "ORDER BY i.created_at ASC"
	}

	if filter.GroupBy != "" {
		return s.groupItems(ctx, projectID, filter, baseQuery, args, argIdx, orderBy)
	}

	var total int
	if err := s.Pool.QueryRow(ctx, `SELECT COUNT(*)`+baseQuery, args...).Scan(&total); err != nil {
		return Page{}, fmt.Errorf("count work items: %w", err)
	}

	query := `SELECT ` + itemColumns + baseQuery + ` ` + orderBy + fmt.Sprintf(` LIMIT $%d OFFSET $%d`, argIdx, argIdx+1)
	args = append(args, filter.Limit, filter.Offset)

	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return Page{}, fmt.Errorf("list work items: %w", err)
	}
	defer rows.Close()
	items := make([]Item, 0, filter.Limit)
	for rows.Next() {
		item, scanErr := scan(rows)
		if scanErr != nil {
			return Page{}, fmt.Errorf("scan work item: %w", scanErr)
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page{}, fmt.Errorf("iterate work items: %w", err)
	}
	expanded, err := expandItems(ctx, s.Pool, items, filter.Expand)
	if err != nil {
		return Page{}, err
	}
	return makePage(expanded, total, filter.Limit, filter.Offset), nil
}

func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID, issueID, expand string) (Item, error) {
	if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
		return Item{}, err
	}
	item, err := scan(s.Pool.QueryRow(ctx, `SELECT `+itemColumns+` FROM issues i JOIN states st ON st.id=i.state_id
		WHERE i.project_id::text=$1 AND i.id::text=$2 AND i.deleted_at IS NULL AND i.archived_at IS NULL AND i.is_draft=FALSE AND st."group" <> 'triage'`, projectID, issueID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	expanded, err := expandItems(ctx, s.Pool, []Item{item}, expand)
	if err != nil {
		return Item{}, err
	}
	return expanded[0], nil
}

type rowScanner interface{ Scan(...any) error }

func scan(row rowScanner) (Item, error) {
	var item Item
	err := row.Scan(&item.ID, &item.SequenceID, &item.Name, &item.DescriptionHTML, &item.SortOrder,
		&item.StateID, &item.Priority, &item.AssigneeIDs, &item.LabelIDs, &item.EstimatePoint,
		&item.SubIssuesCount, &item.AttachmentCount, &item.LinkCount, &item.ProjectID, &item.ParentID,
		&item.CycleID, &item.ModuleIDs, &item.TypeID, &item.CreatedAt, &item.UpdatedAt, &item.StartDate,
		&item.TargetDate, &item.CompletedAt, &item.ArchivedAt, &item.CreatedBy, &item.UpdatedBy, &item.IsDraft)
	return item, err
}

func makePage(items []Item, total, limit, offset int) Page {
	nextOffset := offset + len(items)
	prevOffset := offset - limit
	if prevOffset < 0 {
		prevOffset = 0
	}
	totalPages := 0
	if limit > 0 {
		totalPages = (total + limit - 1) / limit
	}
	return Page{GroupedBy: nil, SubGroupedBy: nil, TotalCount: total,
		NextCursor: fmt.Sprintf("%d:%d:0", limit, nextOffset), PrevCursor: fmt.Sprintf("%d:%d:0", limit, prevOffset),
		NextPage: nextOffset < total, PrevPage: offset > 0, Count: len(items), TotalPages: totalPages,
		ExtraStats: nil, Results: items}
}

func (s PostgreSQLStore) groupItems(ctx context.Context, projectID string, filter IssueFilter, baseQuery string, args []any, argIdx int, orderBy string) (Page, error) {
	// 1. Load all matching items (for grouping we usually load all or a large limit)
	query := `SELECT ` + itemColumns + baseQuery + ` ` + orderBy
	rows, err := s.Pool.Query(ctx, query, args...)
	if err != nil {
		return Page{}, fmt.Errorf("list work items for grouping: %w", err)
	}
	defer rows.Close()

	items := make([]Item, 0)
	for rows.Next() {
		item, scanErr := scan(rows)
		if scanErr != nil {
			return Page{}, fmt.Errorf("scan work item for grouping: %w", scanErr)
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return Page{}, fmt.Errorf("iterate work items for grouping: %w", err)
	}
	expanded, err := expandItems(ctx, s.Pool, items, filter.Expand)
	if err != nil {
		return Page{}, err
	}

	// 2. Perform grouping in memory
	grouped := make(map[string]map[string]any)
	for _, item := range expanded {
		var groupKey string
		switch filter.GroupBy {
		case "state", "state_id":
			if item.StateID != nil {
				groupKey = *item.StateID
			}
		case "priority":
			groupKey = item.Priority
		default:
			groupKey = "None"
		}
		if groupKey == "" {
			groupKey = "None"
		}

		if _, exists := grouped[groupKey]; !exists {
			grouped[groupKey] = map[string]any{
				"results": []Item{},
				"count":   0,
			}
		}

		group := grouped[groupKey]
		results := group["results"].([]Item)
		results = append(results, item)
		group["results"] = results
		group["count"] = len(results)
	}

	return Page{
		GroupedBy:  grouped,
		TotalCount: len(items),
		Count:      len(items),
	}, nil
}
