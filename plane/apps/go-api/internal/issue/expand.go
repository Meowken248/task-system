package issue

import (
	"context"
	"strings"
	"time"
	"github.com/jackc/pgx/v5/pgxpool"
)

func expandItems(ctx context.Context, pool *pgxpool.Pool, items []Item, expandStr string) ([]Item, error) {
	if expandStr == "" || len(items) == 0 {
		return items, nil
	}
	expands := strings.Split(expandStr, ",")
	wants := make(map[string]bool)
	for _, e := range expands {
		wants[strings.TrimSpace(e)] = true
	}

	if wants["state"] {
		// Collect unique state IDs
		stateIDs := make(map[string]bool)
		for _, item := range items {
			if item.StateID != nil {
				stateIDs[*item.StateID] = true
			}
		}
		if len(stateIDs) > 0 {
			ids := make([]string, 0, len(stateIDs))
			for id := range stateIDs {
				ids = append(ids, id)
			}
			rows, err := pool.Query(ctx, `SELECT id::text, name, color, "group", description, project_id::text, workspace_id::text, sequence, default as is_default FROM states WHERE id::text = ANY($1)`, ids)
			if err == nil {
				defer rows.Close()
				states := make(map[string]map[string]any)
				for rows.Next() {
					var id, name, color, group, desc, proj, ws string
					var seq float64
					var isDefault bool
					if err := rows.Scan(&id, &name, &color, &group, &desc, &proj, &ws, &seq, &isDefault); err == nil {
						states[id] = map[string]any{
							"id":           id,
							"name":         name,
							"color":        color,
							"group":        group,
							"description":  desc,
							"project_id":   proj,
							"workspace_id": ws,
							"sequence":     seq,
							"default":      isDefault,
						}
					}
				}
				for i, item := range items {
					if item.StateID != nil {
						if st, ok := states[*item.StateID]; ok {
							items[i].State = st
						}
					}
				}
			}
		}
	}

	if wants["assignees"] {
		assigneeIDs := make(map[string]bool)
		for _, item := range items {
			for _, id := range item.AssigneeIDs {
				assigneeIDs[id] = true
			}
		}
		if len(assigneeIDs) > 0 {
			ids := make([]string, 0, len(assigneeIDs))
			for id := range assigneeIDs {
				ids = append(ids, id)
			}
			rows, err := pool.Query(ctx, `SELECT id::text, first_name, last_name, avatar, email FROM users WHERE id::text = ANY($1)`, ids)
			if err == nil {
				defer rows.Close()
				users := make(map[string]map[string]any)
				for rows.Next() {
					var id, fname, lname, email string
					var avatar *string
					if err := rows.Scan(&id, &fname, &lname, &avatar, &email); err == nil {
						users[id] = map[string]any{
							"id":         id,
							"first_name": fname,
							"last_name":  lname,
							"avatar":     avatar,
							"email":      email,
						}
					}
				}
				for i, item := range items {
					var assignees []any
					for _, aid := range item.AssigneeIDs {
						if u, ok := users[aid]; ok {
							assignees = append(assignees, u)
						}
					}
					items[i].Assignees = assignees
				}
			}
		}
	}

	if wants["labels"] {
		labelIDs := make(map[string]bool)
		for _, item := range items {
			for _, id := range item.LabelIDs {
				labelIDs[id] = true
			}
		}
		if len(labelIDs) > 0 {
			ids := make([]string, 0, len(labelIDs))
			for id := range labelIDs {
				ids = append(ids, id)
			}
			rows, err := pool.Query(ctx, `SELECT id::text, name, color, project_id::text, workspace_id::text FROM issue_labels WHERE id::text = ANY($1)`, ids)
			if err == nil {
				defer rows.Close()
				labels := make(map[string]map[string]any)
				for rows.Next() {
					var id, name, color, proj, ws string
					if err := rows.Scan(&id, &name, &color, &proj, &ws); err == nil {
						labels[id] = map[string]any{
							"id":           id,
							"name":         name,
							"color":        color,
							"project_id":   proj,
							"workspace_id": ws,
						}
					}
				}
				for i, item := range items {
					var itemLabels []any
					for _, lid := range item.LabelIDs {
						if l, ok := labels[lid]; ok {
							itemLabels = append(itemLabels, l)
						}
					}
					items[i].Labels = itemLabels
				}
			}
		}
	}
	
	if wants["issue_attachments"] {
		issueIDs := make([]string, len(items))
		for i, item := range items {
			issueIDs[i] = item.ID
		}
		rows, err := pool.Query(ctx, `SELECT id::text, asset, attributes, issue_id::text FROM file_assets WHERE issue_id::text = ANY($1) AND is_deleted=FALSE`, issueIDs)
		if err == nil {
			defer rows.Close()
			attachments := make(map[string][]map[string]any)
			for rows.Next() {
				var id, asset, issueID string
				var attrs any
				if err := rows.Scan(&id, &asset, &attrs, &issueID); err == nil {
					attachments[issueID] = append(attachments[issueID], map[string]any{
						"id":         id,
						"asset":      asset,
						"attributes": attrs,
					})
				}
			}
			for i, item := range items {
				if atts, ok := attachments[item.ID]; ok {
					items[i].IssueAttachments = atts
				} else {
					items[i].IssueAttachments = []map[string]any{}
				}
			}
		}
	}
	
	if wants["issue_link"] {
		issueIDs := make([]string, len(items))
		for i, item := range items {
			issueIDs[i] = item.ID
		}
		rows, err := pool.Query(ctx, `SELECT id::text, issue_id::text, title, url, metadata, created_by_id::text, created_at FROM issue_links WHERE issue_id::text = ANY($1) AND deleted_at IS NULL`, issueIDs)
		if err == nil {
			defer rows.Close()
			links := make(map[string][]map[string]any)
			for rows.Next() {
				var id, issueID, title, url, creator string
				var meta any
				var createdAt time.Time
				if err := rows.Scan(&id, &issueID, &title, &url, &meta, &creator, &createdAt); err == nil {
					links[issueID] = append(links[issueID], map[string]any{
						"id":            id,
						"issue_id":      issueID,
						"title":         title,
						"url":           url,
						"metadata":      meta,
						"created_by_id": creator,
						"created_at":    createdAt,
					})
				}
			}
			for i, item := range items {
				if lks, ok := links[item.ID]; ok {
					items[i].IssueLink = lks
				} else {
					items[i].IssueLink = []map[string]any{}
				}
			}
		}
	}

	if wants["issue_reactions"] {
		issueIDs := make([]string, len(items))
		for i, item := range items {
			issueIDs[i] = item.ID
		}
		rows, err := pool.Query(ctx, `SELECT ir.id::text, ir.actor_id::text, ir.issue_id::text, ir.reaction, u.display_name FROM issue_reactions ir JOIN users u ON u.id = ir.actor_id WHERE ir.issue_id::text = ANY($1) AND ir.deleted_at IS NULL`, issueIDs)
		if err == nil {
			defer rows.Close()
			reactions := make(map[string][]map[string]any)
			for rows.Next() {
				var id, actor, issueID, reaction, displayName string
				if err := rows.Scan(&id, &actor, &issueID, &reaction, &displayName); err == nil {
					reactions[issueID] = append(reactions[issueID], map[string]any{
						"id":           id,
						"actor":        actor,
						"issue":        issueID,
						"reaction":     reaction,
						"display_name": displayName,
					})
				}
			}
			for i, item := range items {
				if rxns, ok := reactions[item.ID]; ok {
					items[i].IssueReactions = rxns
				} else {
					items[i].IssueReactions = []map[string]any{}
				}
			}
		}
	}

	if wants["issue_relation"] || wants["issue_related"] {
		issueIDs := make([]string, len(items))
		for i, item := range items {
			issueIDs[i] = item.ID
		}
		
		// issue_relation: items where this issue is the 'issue_id', related is 'related_issue_id'
		if wants["issue_relation"] {
			rows, err := pool.Query(ctx, `SELECT ir.related_issue_id::text, ir.relation_type,
				ri.project_id::text, ri.sequence_id, ri.name, ri.state_id::text, ri.priority, ri.created_by_id::text,
				ir.created_at, ir.updated_at, ir.updated_by_id::text, ir.issue_id::text
				FROM issue_relations ir
				JOIN issues ri ON ri.id = ir.related_issue_id
				WHERE ir.issue_id::text = ANY($1) AND ir.deleted_at IS NULL AND ri.deleted_at IS NULL`, issueIDs)
			if err == nil {
				defer rows.Close()
				relations := make(map[string][]map[string]any)
				for rows.Next() {
					var id, relType, proj, name, priority string
					var stateID, createdBy, updatedBy *string
					var seq int
					var created, updated time.Time
					var sourceIssueID string
					if err := rows.Scan(&id, &relType, &proj, &seq, &name, &stateID, &priority, &createdBy, &created, &updated, &updatedBy, &sourceIssueID); err == nil {
						// Note: assignee_ids skipped for brevity, can be fetched if needed
						relations[sourceIssueID] = append(relations[sourceIssueID], map[string]any{
							"id":            id,
							"project_id":    proj,
							"sequence_id":   seq,
							"relation_type": relType,
							"name":          name,
							"state_id":      stateID,
							"priority":      priority,
							"created_by":    createdBy,
							"created_at":    created,
							"updated_at":    updated,
							"updated_by":    updatedBy,
						})
					}
				}
				for i, item := range items {
					if rels, ok := relations[item.ID]; ok {
						items[i].IssueRelation = rels
					} else {
						items[i].IssueRelation = []map[string]any{}
					}
				}
			}
		}

		// issue_related: items where this issue is the 'related_issue_id', source is 'issue_id'
		if wants["issue_related"] {
			rows, err := pool.Query(ctx, `SELECT ir.issue_id::text, ir.relation_type,
				ri.project_id::text, ri.sequence_id, ri.name, ri.state_id::text, ri.priority, ri.created_by_id::text,
				ir.created_at, ir.updated_at, ir.updated_by_id::text, ir.related_issue_id::text
				FROM issue_relations ir
				JOIN issues ri ON ri.id = ir.issue_id
				WHERE ir.related_issue_id::text = ANY($1) AND ir.deleted_at IS NULL AND ri.deleted_at IS NULL`, issueIDs)
			if err == nil {
				defer rows.Close()
				relations := make(map[string][]map[string]any)
				for rows.Next() {
					var id, relType, proj, name, priority string
					var stateID, createdBy, updatedBy *string
					var seq int
					var created, updated time.Time
					var targetIssueID string
					if err := rows.Scan(&id, &relType, &proj, &seq, &name, &stateID, &priority, &createdBy, &created, &updated, &updatedBy, &targetIssueID); err == nil {
						relations[targetIssueID] = append(relations[targetIssueID], map[string]any{
							"id":            id,
							"project_id":    proj,
							"sequence_id":   seq,
							"relation_type": relType,
							"name":          name,
							"state_id":      stateID,
							"priority":      priority,
							"created_by":    createdBy,
							"created_at":    created,
							"updated_at":    updated,
							"updated_by":    updatedBy,
						})
					}
				}
				for i, item := range items {
					if rels, ok := relations[item.ID]; ok {
						items[i].IssueRelated = rels
					} else {
						items[i].IssueRelated = []map[string]any{}
					}
				}
			}
		}
	}

	if wants["parent"] {
		parentIDs := make(map[string]bool)
		for _, item := range items {
			if item.ParentID != nil {
				parentIDs[*item.ParentID] = true
			}
		}
		if len(parentIDs) > 0 {
			ids := make([]string, 0, len(parentIDs))
			for id := range parentIDs {
				ids = append(ids, id)
			}
			rows, err := pool.Query(ctx, `SELECT id::text, sequence_id, project_id::text FROM issues WHERE id::text = ANY($1)`, ids)
			if err == nil {
				defer rows.Close()
				parents := make(map[string]map[string]any)
				for rows.Next() {
					var id, proj string
					var seq int
					if err := rows.Scan(&id, &seq, &proj); err == nil {
						parents[id] = map[string]any{
							"id":          id,
							"sequence_id": seq,
							"project_id":  proj,
						}
					}
				}
				for i, item := range items {
					if item.ParentID != nil {
						if p, ok := parents[*item.ParentID]; ok {
							items[i].Parent = p
						}
					}
				}
			}
		}
	}

	return items, nil
}
