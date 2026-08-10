package subissue

import (
	"context"
	"fmt"
)

type SubIssuePayload struct {
	SubIssueIDs []string `json:"sub_issue_ids"`
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID, issueID string, payload SubIssuePayload) (map[string]any, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}

	if len(payload.SubIssueIDs) == 0 {
		return nil, fmt.Errorf("sub_issue_ids is required")
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Validate parent issue
	var validParent bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issues WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, issueID, projectID).Scan(&validParent)
	if err != nil {
		return nil, err
	}
	if !validParent {
		return nil, fmt.Errorf("parent issue not found")
	}

	for _, subID := range payload.SubIssueIDs {
		// Update parent_id
		res, err := tx.Exec(ctx, `UPDATE issues SET parent_id=$1::uuid, updated_by_id=$3::uuid, updated_at=NOW() WHERE id::text=$2 AND project_id::text=$4 AND deleted_at IS NULL`, issueID, subID, identity.UserID, projectID)
		if err != nil {
			return nil, err
		}
		if res.RowsAffected() == 0 {
			continue
		}
		
		// Insert activity
		_, err = tx.Exec(ctx, `INSERT INTO issue_activities (id, issue_id, actor_id, workspace_id, project_id, field, new_value, created_by_id, updated_by_id, created_at, updated_at) 
			VALUES (gen_random_uuid(), $1::uuid, $3::uuid, $5::uuid, $4::uuid, 'parent', $2, $3::uuid, $3::uuid, NOW(), NOW())`,
			subID, issueID, identity.UserID, projectID, identity.WorkspaceID)
		if err != nil {
			return nil, err
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}

	return map[string]any{"message": "Sub-issues created successfully"}, nil
}
