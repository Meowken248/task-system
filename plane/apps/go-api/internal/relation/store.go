package relation

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

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("relation not found")
	ErrInvalid      = errors.New("invalid relation")
)

type RelationItem struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	StateID      string    `json:"state_id"`
	SortOrder    float64   `json:"sort_order"`
	Priority     string    `json:"priority"`
	SequenceID   int       `json:"sequence_id"`
	ProjectID    string    `json:"project_id"`
	LabelIDs     []string  `json:"label_ids"`
	AssigneeIDs  []string  `json:"assignee_ids"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	CreatedBy    *string   `json:"created_by"`
	UpdatedBy    *string   `json:"updated_by"`
	RelationType string    `json:"relation_type"`
}

type ListResponse struct {
	Blocking     []RelationItem `json:"blocking"`
	BlockedBy    []RelationItem `json:"blocked_by"`
	Duplicate    []RelationItem `json:"duplicate"`
	RelatesTo    []RelationItem `json:"relates_to"`
	StartAfter   []RelationItem `json:"start_after"`
	StartBefore  []RelationItem `json:"start_before"`
	FinishAfter  []RelationItem `json:"finish_after"`
	FinishBefore []RelationItem `json:"finish_before"`
}

type CreatePayload struct {
	RelationType string   `json:"relation_type"`
	Issues       []string `json:"issues"`
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
		WHERE s.session_key=$1 AND s.expire_date>NOW()`).Scan(&identity.UserID, &identity.WorkspaceID, &identity.Role)
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

func getActualRelation(relType string) string {
	switch relType {
	case "blocking", "blocked_by":
		return "blocked_by"
	case "start_after", "start_before":
		return "start_before"
	case "finish_after", "finish_before":
		return "finish_before"
	default:
		return relType
	}
}

// ListForSession retrieves all issue relations and maps them to their respective lists.
func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID, issueID string) (ListResponse, error) {
	if _, err := s.writeIdentity(ctx, sessionKey, slug, projectID); err != nil {
		return ListResponse{}, err
	}

	// Fetch relations of this issue
	rows, err := s.Pool.Query(ctx, `SELECT r.id::text, r.issue_id::text, r.related_issue_id::text, r.relation_type
		FROM issue_relations r
		WHERE (r.issue_id::text=$1 OR r.related_issue_id::text=$1) AND r.project_id::text=$2 AND r.deleted_at IS NULL`, issueID, projectID)
	if err != nil {
		return ListResponse{}, err
	}
	defer rows.Close()

	type rawRel struct {
		id        string
		issueID   string
		relIssue  string
		relType   string
	}
	var rawRels []rawRel
	for rows.Next() {
		var r rawRel
		if err := rows.Scan(&r.id, &r.issueID, &r.relIssue, &r.relType); err != nil {
			return ListResponse{}, err
		}
		rawRels = append(rawRels, r)
	}

	res := ListResponse{
		Blocking:     []RelationItem{},
		BlockedBy:    []RelationItem{},
		Duplicate:    []RelationItem{},
		RelatesTo:    []RelationItem{},
		StartAfter:   []RelationItem{},
		StartBefore:  []RelationItem{},
		FinishAfter:  []RelationItem{},
		FinishBefore: []RelationItem{},
	}

	if len(rawRels) == 0 {
		return res, nil
	}

	// Helper to scan a relation details from issue table
	fetchDetails := func(id string, relType string) (RelationItem, error) {
		var item RelationItem
		err := s.Pool.QueryRow(ctx, `SELECT i.id::text, i.name, i.state_id::text, i.sort_order, i.priority, i.sequence_id, i.project_id::text,
			ARRAY(SELECT il.label_id::text FROM issue_labels il WHERE il.issue_id=i.id AND il.deleted_at IS NULL),
			ARRAY(SELECT ia.assignee_id::text FROM issue_assignees ia WHERE ia.issue_id=i.id AND ia.deleted_at IS NULL),
			i.created_at, i.updated_at, i.created_by_id::text, i.updated_by_id::text
			FROM issues i
			WHERE i.id::text=$1 AND i.deleted_at IS NULL`, id).Scan(
			&item.ID, &item.Name, &item.StateID, &item.SortOrder, &item.Priority, &item.SequenceID, &item.ProjectID,
			&item.LabelIDs, &item.AssigneeIDs, &item.CreatedAt, &item.UpdatedAt, &item.CreatedBy, &item.UpdatedBy)
		if err != nil {
			return RelationItem{}, err
		}
		if item.LabelIDs == nil {
			item.LabelIDs = []string{}
		}
		if item.AssigneeIDs == nil {
			item.AssigneeIDs = []string{}
		}
		item.RelationType = relType
		return item, nil
	}

	for _, r := range rawRels {
		var targetID string
		var actualType string

		switch r.relType {
		case "blocked_by":
			if r.relIssue == issueID {
				targetID = r.issueID
				actualType = "blocking"
			} else {
				targetID = r.relIssue
				actualType = "blocked_by"
			}
		case "start_before":
			if r.relIssue == issueID {
				targetID = r.issueID
				actualType = "start_after"
			} else {
				targetID = r.relIssue
				actualType = "start_before"
			}
		case "finish_before":
			if r.relIssue == issueID {
				targetID = r.issueID
				actualType = "finish_after"
			} else {
				targetID = r.relIssue
				actualType = "finish_before"
			}
		case "duplicate":
			if r.issueID == issueID {
				targetID = r.relIssue
			} else {
				targetID = r.issueID
			}
			actualType = "duplicate"
		case "relates_to":
			if r.issueID == issueID {
				targetID = r.relIssue
			} else {
				targetID = r.issueID
			}
			actualType = "relates_to"
		}

		if targetID != "" {
			item, err := fetchDetails(targetID, actualType)
			if err != nil {
				continue // Skip if issue details not found or deleted
			}
			switch actualType {
			case "blocking":
				res.Blocking = append(res.Blocking, item)
			case "blocked_by":
				res.BlockedBy = append(res.BlockedBy, item)
			case "duplicate":
				res.Duplicate = append(res.Duplicate, item)
			case "relates_to":
				res.RelatesTo = append(res.RelatesTo, item)
			case "start_after":
				res.StartAfter = append(res.StartAfter, item)
			case "start_before":
				res.StartBefore = append(res.StartBefore, item)
			case "finish_after":
				res.FinishAfter = append(res.FinishAfter, item)
			case "finish_before":
				res.FinishBefore = append(res.FinishBefore, item)
			}
		}
	}

	return res, nil
}

type CreatedRelation struct {
	ID           string    `json:"id"`
	WorkspaceID  string    `json:"workspace"`
	ProjectID    string    `json:"project"`
	IssueID      string    `json:"issue"`
	RelatedIssue string    `json:"related_issue"`
	RelationType string    `json:"relation_type"`
	CreatedBy    string    `json:"created_by"`
	UpdatedBy    string    `json:"updated_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// CreateForSession creates bulk issue relations.
func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID, issueID string, input CreatePayload) ([]CreatedRelation, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}
	if identity.Role < 15 { // Minimum MEMBER role required
		return nil, ErrForbidden
	}
	if input.RelationType == "" || len(input.Issues) == 0 {
		return nil, fmt.Errorf("%w: relation_type and issues required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	actualType := getActualRelation(input.RelationType)
	createdRels := make([]CreatedRelation, 0, len(input.Issues))

	for _, targetID := range input.Issues {
		var srcID, relID string
		if input.RelationType == "blocking" || input.RelationType == "start_after" || input.RelationType == "finish_after" {
			srcID = targetID
			relID = issueID
		} else {
			srcID = issueID
			relID = targetID
		}

		// Check if relation already exists (avoid duplicate constraint error)
		var exists bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issue_relations
			WHERE issue_id::text=$1 AND related_issue_id::text=$2 AND deleted_at IS NULL)`, srcID, relID).Scan(&exists)
		if err != nil {
			return nil, err
		}
		if exists {
			continue
		}

		relIDUUID := newUUID()
		createdAt := time.Now()
		_, err = tx.Exec(ctx, `INSERT INTO issue_relations
			(id, project_id, workspace_id, issue_id, related_issue_id, relation_type,
			 created_by_id, updated_by_id, created_at, updated_at)
			VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$7::uuid,$8,$8)`,
			relIDUUID, projectID, identity.WorkspaceID, srcID, relID, actualType, identity.UserID, createdAt)
		if err != nil {
			return nil, err
		}

		createdRels = append(createdRels, CreatedRelation{
			ID:           relIDUUID,
			WorkspaceID:  identity.WorkspaceID,
			ProjectID:    projectID,
			IssueID:      srcID,
			RelatedIssue: relID,
			RelationType: actualType,
			CreatedBy:    identity.UserID,
			UpdatedBy:    identity.UserID,
			CreatedAt:    createdAt,
			UpdatedAt:    createdAt,
		})

		// Record activity
		activityComment := fmt.Sprintf("added a relation: %s", input.RelationType)
		_, err = tx.Exec(ctx, `INSERT INTO issue_activities
			(id, issue_id, verb, comment, attachments, actor_id, epoch,
			 project_id, workspace_id, created_by_id, created_at, updated_at)
			VALUES ($1,$2::uuid,'created',$3,'{}'::text[],$4,$5,$6::uuid,$7::uuid,$4,NOW(),NOW())`,
			newUUID(), issueID, activityComment, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
		if err != nil {
			return nil, err
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return createdRels, nil
}

// RemoveForSession deletes relation between two issues.
func (s PostgreSQLStore) RemoveForSession(ctx context.Context, sessionKey, slug, projectID, issueID, relatedIssue string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if identity.Role < 15 {
		return ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var relID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM issue_relations
		WHERE workspace_id::text=$1 AND deleted_at IS NULL AND
		((issue_id::text=$2 AND related_issue_id::text=$3) OR (issue_id::text=$3 AND related_issue_id::text=$2))
		LIMIT 1`, identity.WorkspaceID, issueID, relatedIssue).Scan(&relID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `UPDATE issue_relations SET deleted_at=NOW(), updated_by_id=$2, updated_at=NOW()
		WHERE id::text=$1`, relID, identity.UserID)
	if err != nil {
		return err
	}

	// Record activity
	activityComment := "removed a relation"
	_, err = tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, verb, comment, attachments, actor_id, epoch,
		 project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,'deleted',$3,'{}'::text[],$4,$5,$6::uuid,$7::uuid,$4,NOW(),NOW())`,
		newUUID(), issueID, activityComment, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}
