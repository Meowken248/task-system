package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type SubIssueItem struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	StateID         string     `json:"state_id"`
	SortOrder       float64    `json:"sort_order"`
	CompletedAt     *time.Time `json:"completed_at"`
	EstimatePoint   *string    `json:"estimate_point"`
	Priority        string     `json:"priority"`
	StartDate       *time.Time `json:"start_date"`
	TargetDate      *time.Time `json:"target_date"`
	SequenceID      int        `json:"sequence_id"`
	ProjectID       string     `json:"project_id"`
	ParentID        string     `json:"parent_id"`
	CycleID         *string    `json:"cycle_id"`
	ModuleIDs       []string   `json:"module_ids"`
	LabelIDs        []string   `json:"label_ids"`
	AssigneeIDs     []string   `json:"assignee_ids"`
	SubIssuesCount  int        `json:"sub_issues_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	CreatedBy       *string    `json:"created_by"`
	UpdatedBy       *string    `json:"updated_by"`
	AttachmentCount int        `json:"attachment_count"`
	LinkCount       int        `json:"link_count"`
	IsDraft         bool       `json:"is_draft"`
	ArchivedAt      *time.Time `json:"archived_at"`
	StateGroup      string     `json:"state_group"`
}

func main() {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, "postgres://plane:plane@localhost:5432/plane?sslmode=disable")
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	issueID := "135152cb-5cb4-4c33-927e-e3b459242061"
	projectID := "7323eeb6-95a3-47c7-9e9b-7902b158aaac"

	rows, err := pool.Query(ctx, `SELECT
		i.id::text, i.name, i.state_id::text, i.sort_order, i.completed_at, i.estimate_point_id::text, i.priority,
		i.start_date, i.target_date, i.sequence_id, i.project_id::text, COALESCE(i.parent_id::text, ''),
		(SELECT ci.cycle_id::text FROM cycle_issues ci WHERE ci.issue_id=i.id AND ci.deleted_at IS NULL LIMIT 1),
		ARRAY(SELECT mi.module_id::text FROM module_issues mi JOIN modules m ON m.id=mi.module_id WHERE mi.issue_id=i.id AND mi.deleted_at IS NULL AND m.archived_at IS NULL),
		ARRAY(SELECT il.label_id::text FROM issue_labels il WHERE il.issue_id=i.id AND il.deleted_at IS NULL),
		ARRAY(SELECT ia.assignee_id::text FROM issue_assignees ia WHERE ia.issue_id=i.id AND ia.deleted_at IS NULL),
		(SELECT COUNT(*)::int FROM issues sub WHERE sub.parent_id=i.id AND sub.deleted_at IS NULL),
		i.created_at, i.updated_at, i.created_by_id::text, i.updated_by_id::text,
		(SELECT COUNT(*)::int FROM file_assets fa WHERE fa.issue_id=i.id AND fa.entity_type='issue_attachment' AND fa.deleted_at IS NULL),
		(SELECT COUNT(*)::int FROM issue_links il WHERE il.issue_id=i.id AND il.deleted_at IS NULL),
		i.is_draft, i.archived_at, st.group
		FROM issues i
		JOIN states st ON st.id=i.state_id
		WHERE i.parent_id::text=$1 AND i.project_id::text=$2 AND i.deleted_at IS NULL
		ORDER BY i.created_at DESC`, issueID, projectID)

	if err != nil {
		log.Fatalf("Query failed: %v", err)
	}
	defer rows.Close()

	for rows.Next() {
		var item SubIssueItem
		err := rows.Scan(
			&item.ID, &item.Name, &item.StateID, &item.SortOrder, &item.CompletedAt, &item.EstimatePoint, &item.Priority,
			&item.StartDate, &item.TargetDate, &item.SequenceID, &item.ProjectID, &item.ParentID,
			&item.CycleID, &item.ModuleIDs, &item.LabelIDs, &item.AssigneeIDs, &item.SubIssuesCount,
			&item.CreatedAt, &item.UpdatedAt, &item.CreatedBy, &item.UpdatedBy,
			&item.AttachmentCount, &item.LinkCount, &item.IsDraft, &item.ArchivedAt, &item.StateGroup)
		if err != nil {
			log.Fatalf("Scan failed: %v", err)
		}
		fmt.Printf("Scanned issue: %s\n", item.ID)
	}
}
