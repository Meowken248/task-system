package subissue

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

type ListResponse struct {
	SubIssues         any                 `json:"sub_issues"` // can be array or object (grouped)
	StateDistribution map[string][]string `json:"state_distribution"`
}

type writeIdentity struct {
	UserID      string
	WorkspaceID string
	Role        int
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) writeIdentity(ctx context.Context, sessionKey, slug, projectID string) (writeIdentity, error) {
	if s.Pool == nil {
		return writeIdentity{}, errors.New("database unavailable")
	}
	if sessionKey == "" {
		return writeIdentity{}, ErrUnauthorized
	}
	var identity writeIdentity
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, pm.role
		FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug, projectID).Scan(&identity.UserID, &identity.WorkspaceID, &identity.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		var valid bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); checkErr != nil {
			return writeIdentity{}, fmt.Errorf("check session: %w", checkErr)
		}
		if valid {
			return writeIdentity{}, ErrForbidden
		}
		return writeIdentity{}, ErrUnauthorized
	}
	return identity, err
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID, issueID, groupBy string) (ListResponse, error) {
	_, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return ListResponse{}, err
	}

	rows, err := s.Pool.Query(ctx, `SELECT
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
		return ListResponse{}, err
	}
	defer rows.Close()

	subIssues := []SubIssueItem{}
	stateDistribution := make(map[string][]string)

	for rows.Next() {
		var item SubIssueItem
		err := rows.Scan(
			&item.ID, &item.Name, &item.StateID, &item.SortOrder, &item.CompletedAt, &item.EstimatePoint, &item.Priority,
			&item.StartDate, &item.TargetDate, &item.SequenceID, &item.ProjectID, &item.ParentID,
			&item.CycleID, &item.ModuleIDs, &item.LabelIDs, &item.AssigneeIDs, &item.SubIssuesCount,
			&item.CreatedAt, &item.UpdatedAt, &item.CreatedBy, &item.UpdatedBy,
			&item.AttachmentCount, &item.LinkCount, &item.IsDraft, &item.ArchivedAt, &item.StateGroup)
		if err != nil {
			return ListResponse{}, err
		}
		if item.ModuleIDs == nil {
			item.ModuleIDs = []string{}
		}
		if item.LabelIDs == nil {
			item.LabelIDs = []string{}
		}
		if item.AssigneeIDs == nil {
			item.AssigneeIDs = []string{}
		}

		subIssues = append(subIssues, item)
		stateDistribution[item.StateGroup] = append(stateDistribution[item.StateGroup], item.ID)
	}

	if groupBy == "" {
		return ListResponse{
			SubIssues:         subIssues,
			StateDistribution: stateDistribution,
		}, nil
	}

	// Dynamic grouping
	resultDict := make(map[string][]SubIssueItem)
	for _, issue := range subIssues {
		if groupBy == "assignees__ids" {
			if len(issue.AssigneeIDs) > 0 {
				for _, assigneeID := range issue.AssigneeIDs {
					resultDict[assigneeID] = append(resultDict[assigneeID], issue)
				}
			} else {
				resultDict["None"] = append(resultDict["None"], issue)
			}
		} else {
			// fallback key grouping
			var valKey string
			switch groupBy {
			case "priority":
				valKey = issue.Priority
			case "state_id":
				valKey = issue.StateID
			default:
				valKey = "None"
			}
			resultDict[valKey] = append(resultDict[valKey], issue)
		}
	}

	return ListResponse{
		SubIssues:         resultDict,
		StateDistribution: stateDistribution,
	}, nil
}
