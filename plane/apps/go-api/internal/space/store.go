package space

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("not found")
)

type Store interface {
	GetProjectMeta(ctx context.Context, anchor string) (map[string]any, error)
	GetProjectSettings(ctx context.Context, anchor string) (map[string]any, error)
	GetProjectMembers(ctx context.Context, anchor string) ([]map[string]any, error)
	GetProjectCycles(ctx context.Context, anchor string) ([]map[string]any, error)
	GetProjectModules(ctx context.Context, anchor string) ([]map[string]any, error)
	GetProjectStates(ctx context.Context, anchor string) ([]map[string]any, error)
	GetProjectLabels(ctx context.Context, anchor string) ([]map[string]any, error)
	GetProjectIssueVotes(ctx context.Context, projectID, issueID string) ([]map[string]any, error)
	GetWorkspaceProjectAnchor(ctx context.Context, slug, projectID string) (map[string]any, error)
	GetWorkspaceProjectDeployBoards(ctx context.Context, slug string) ([]map[string]any, error)
	// TODO: Add methods for issues etc.
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

// GetProjectMeta corresponds to ProjectMetaDataEndpoint
func (s PostgreSQLStore) GetProjectMeta(ctx context.Context, anchor string) (map[string]any, error) {
	var projectID string
	err := s.Pool.QueryRow(ctx, `
		SELECT entity_identifier 
		FROM deploy_boards 
		WHERE anchor = $1 AND entity_name = 'project' AND deleted_at IS NULL
	`, anchor).Scan(&projectID)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get deploy board: %w", err)
	}

	var id, identifier, name string
	var coverImage, iconProp, emoji, description *string
	err = s.Pool.QueryRow(ctx, `
		SELECT id, identifier, name, cover_image, icon_prop, emoji, description
		FROM projects
		WHERE id::text = $1 AND deleted_at IS NULL
	`, projectID).Scan(
		&id, &identifier, &name,
		&coverImage, &iconProp, &emoji, &description,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get project meta: %w", err)
	}

	meta := map[string]any{
		"id":          id,
		"identifier":  identifier,
		"name":        name,
		"cover_image": coverImage,
		"icon_prop":   iconProp,
		"emoji":       emoji,
		"description": description,
	}

	return meta, nil
}

// GetProjectSettings corresponds to ProjectDeployBoardPublicSettingsEndpoint
func (s PostgreSQLStore) GetProjectSettings(ctx context.Context, anchor string) (map[string]any, error) {
	var id, workspace, project, entityIdentifier, entityName, boardAnchor string
	var createdBy, updatedBy *string
	var intakeID *string
	var createdAt, updatedAt time.Time
	var isCommentsEnabled, isReactionsEnabled, isVotesEnabled, isActivityEnabled, isDisabled bool
	var viewProps map[string]any

	err := s.Pool.QueryRow(ctx, `
		SELECT id, created_at, updated_at, workspace_id, project_id, entity_identifier, entity_name, anchor, 
		       is_comments_enabled, is_reactions_enabled, is_votes_enabled, is_activity_enabled, is_disabled, 
		       view_props, intake_id, created_by_id, updated_by_id
		FROM deploy_boards
		WHERE anchor = $1 AND entity_name = 'project' AND deleted_at IS NULL
	`, anchor).Scan(
		&id, &createdAt, &updatedAt,
		&workspace, &project, &entityIdentifier,
		&entityName, &boardAnchor,
		&isCommentsEnabled, &isReactionsEnabled,
		&isVotesEnabled, &isActivityEnabled,
		&isDisabled, &viewProps,
		&intakeID, &createdBy, &updatedBy,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get project settings: %w", err)
	}

	settings := map[string]any{
		"id":                   id,
		"created_at":           createdAt,
		"updated_at":           updatedAt,
		"workspace":            workspace,
		"project":              project,
		"entity_identifier":    entityIdentifier,
		"entity_name":          entityName,
		"anchor":               boardAnchor,
		"is_comments_enabled":  isCommentsEnabled,
		"is_reactions_enabled": isReactionsEnabled,
		"is_votes_enabled":     isVotesEnabled,
		"is_activity_enabled":  isActivityEnabled,
		"is_disabled":          isDisabled,
		"view_props":           viewProps,
		"intake":               intakeID,
		"created_by":           createdBy,
		"updated_by":           updatedBy,
	}

	return settings, nil
}

// GetProjectMembers corresponds to ProjectMembersEndpoint
func (s PostgreSQLStore) GetProjectMembers(ctx context.Context, anchor string) ([]map[string]any, error) {
	var projectID, workspaceID string
	err := s.Pool.QueryRow(ctx, `
		SELECT project_id, workspace_id
		FROM deploy_boards 
		WHERE anchor = $1 AND entity_name = 'project' AND deleted_at IS NULL
	`, anchor).Scan(&projectID, &workspaceID)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get deploy board: %w", err)
	}

	rows, err := s.Pool.Query(ctx, `
		SELECT pm.id, pm.member_id, u.display_name, u.avatar
		FROM project_members pm
		JOIN users u ON u.id = pm.member_id
		WHERE pm.project_id = $1 AND pm.workspace_id = $2 AND pm.is_active = TRUE AND pm.deleted_at IS NULL
	`, projectID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("query members: %w", err)
	}
	defer rows.Close()

	var members []map[string]any
	for rows.Next() {
		var member = make(map[string]any)
		var id string
		var memberID, displayName, avatar *string
		if err := rows.Scan(&id, &memberID, &displayName, &avatar); err != nil {
			return nil, fmt.Errorf("scan member: %w", err)
		}
		member["id"] = id
		member["member"] = memberID
		member["member__display_name"] = displayName
		member["member__avatar"] = avatar
		members = append(members, member)
	}

	if members == nil {
		members = []map[string]any{}
	}

	return members, nil
}

// GetProjectCycles corresponds to ProjectCyclesEndpoint
func (s PostgreSQLStore) GetProjectCycles(ctx context.Context, anchor string) ([]map[string]any, error) {
	var projectID string
	err := s.Pool.QueryRow(ctx, "SELECT project_id FROM deploy_boards WHERE anchor = $1 AND entity_name = 'project' AND deleted_at IS NULL", anchor).Scan(&projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get deploy board: %w", err)
	}

	rows, err := s.Pool.Query(ctx, "SELECT id, name FROM cycles WHERE project_id = $1 AND deleted_at IS NULL", projectID)
	if err != nil {
		return nil, fmt.Errorf("query cycles: %w", err)
	}
	defer rows.Close()

	var results []map[string]any
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("scan cycle: %w", err)
		}
		results = append(results, map[string]any{"id": id, "name": name})
	}
	if results == nil {
		results = []map[string]any{}
	}
	return results, nil
}

// GetProjectModules corresponds to ProjectModulesEndpoint
func (s PostgreSQLStore) GetProjectModules(ctx context.Context, anchor string) ([]map[string]any, error) {
	var projectID string
	err := s.Pool.QueryRow(ctx, "SELECT project_id FROM deploy_boards WHERE anchor = $1 AND entity_name = 'project' AND deleted_at IS NULL", anchor).Scan(&projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get deploy board: %w", err)
	}

	rows, err := s.Pool.Query(ctx, "SELECT id, name FROM modules WHERE project_id = $1 AND deleted_at IS NULL", projectID)
	if err != nil {
		return nil, fmt.Errorf("query modules: %w", err)
	}
	defer rows.Close()

	var results []map[string]any
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("scan module: %w", err)
		}
		results = append(results, map[string]any{"id": id, "name": name})
	}
	if results == nil {
		results = []map[string]any{}
	}
	return results, nil
}

// GetProjectStates corresponds to ProjectStatesEndpoint
func (s PostgreSQLStore) GetProjectStates(ctx context.Context, anchor string) ([]map[string]any, error) {
	var projectID string
	err := s.Pool.QueryRow(ctx, "SELECT project_id FROM deploy_boards WHERE anchor = $1 AND entity_name = 'project' AND deleted_at IS NULL", anchor).Scan(&projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get deploy board: %w", err)
	}

	rows, err := s.Pool.Query(ctx, "SELECT id, name, \"group\", color, sequence FROM states WHERE project_id = $1 AND name != 'Triage' AND deleted_at IS NULL", projectID)
	if err != nil {
		return nil, fmt.Errorf("query states: %w", err)
	}
	defer rows.Close()

	var results []map[string]any
	for rows.Next() {
		var id, name, group, color string
		var sequence float64
		if err := rows.Scan(&id, &name, &group, &color, &sequence); err != nil {
			return nil, fmt.Errorf("scan state: %w", err)
		}
		results = append(results, map[string]any{
			"id":       id,
			"name":     name,
			"group":    group,
			"color":    color,
			"sequence": sequence,
		})
	}
	if results == nil {
		results = []map[string]any{}
	}
	return results, nil
}

// GetProjectLabels corresponds to ProjectLabelsEndpoint
func (s PostgreSQLStore) GetProjectLabels(ctx context.Context, anchor string) ([]map[string]any, error) {
	var projectID string
	err := s.Pool.QueryRow(ctx, "SELECT project_id FROM deploy_boards WHERE anchor = $1 AND entity_name = 'project' AND deleted_at IS NULL", anchor).Scan(&projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get deploy board: %w", err)
	}

	rows, err := s.Pool.Query(ctx, "SELECT id, name, color, parent_id FROM issue_labels WHERE project_id = $1 AND deleted_at IS NULL", projectID)
	if err != nil {
		return nil, fmt.Errorf("query labels: %w", err)
	}
	defer rows.Close()

	var results []map[string]any
	for rows.Next() {
		var id, name, color string
		var parentID *string
		if err := rows.Scan(&id, &name, &color, &parentID); err != nil {
			return nil, fmt.Errorf("scan label: %w", err)
		}
		results = append(results, map[string]any{
			"id":     id,
			"name":   name,
			"color":  color,
			"parent": parentID,
		})
	}
	if results == nil {
		results = []map[string]any{}
	}
	return results, nil
}

// GetWorkspaceProjectAnchor corresponds to WorkspaceProjectAnchorEndpoint
func (s PostgreSQLStore) GetWorkspaceProjectAnchor(ctx context.Context, slug, projectID string) (map[string]any, error) {
	var id, workspace, project, entityIdentifier, entityName, boardAnchor string
	var createdBy, updatedBy *string
	var intakeID *string
	var createdAt, updatedAt time.Time
	var isCommentsEnabled, isReactionsEnabled, isVotesEnabled, isActivityEnabled, isDisabled bool
	var viewProps map[string]any

	err := s.Pool.QueryRow(ctx, "SELECT db.id, db.created_at, db.updated_at, db.workspace_id, db.project_id, db.entity_identifier, db.entity_name, db.anchor, db.is_comments_enabled, db.is_reactions_enabled, db.is_votes_enabled, db.is_activity_enabled, db.is_disabled, db.view_props, db.intake_id, db.created_by_id, db.updated_by_id FROM deploy_boards db JOIN workspaces w ON w.id = db.workspace_id WHERE w.slug = $1 AND db.project_id::text = $2 AND db.entity_name = 'project' AND db.deleted_at IS NULL AND w.deleted_at IS NULL", slug, projectID).Scan(
		&id, &createdAt, &updatedAt,
		&workspace, &project, &entityIdentifier,
		&entityName, &boardAnchor,
		&isCommentsEnabled, &isReactionsEnabled,
		&isVotesEnabled, &isActivityEnabled,
		&isDisabled, &viewProps,
		&intakeID, &createdBy, &updatedBy,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get project settings: %w", err)
	}

	settings := map[string]any{
		"id":                   id,
		"created_at":           createdAt,
		"updated_at":           updatedAt,
		"workspace":            workspace,
		"project":              project,
		"entity_identifier":    entityIdentifier,
		"entity_name":          entityName,
		"anchor":               boardAnchor,
		"is_comments_enabled":  isCommentsEnabled,
		"is_reactions_enabled": isReactionsEnabled,
		"is_votes_enabled":     isVotesEnabled,
		"is_activity_enabled":  isActivityEnabled,
		"is_disabled":          isDisabled,
		"view_props":           viewProps,
		"intake":               intakeID,
		"created_by":           createdBy,
		"updated_by":           updatedBy,
	}

	return settings, nil
}

func (s PostgreSQLStore) GetProjectIssueVotes(ctx context.Context, projectID, issueID string) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `SELECT v.id, v.vote, v.issue_id, v.actor_id, v.project_id, v.workspace_id,
		v.created_by_id, v.updated_by_id, v.created_at, v.updated_at
		FROM issue_votes v
		WHERE v.project_id::text = $1 AND v.issue_id::text = $2 AND v.deleted_at IS NULL
		ORDER BY v.created_at ASC`, projectID, issueID)
	if err != nil {
		return nil, fmt.Errorf("query issue votes: %w", err)
	}
	defer rows.Close()

	var votes []map[string]any
	for rows.Next() {
		var id, issue_id, actor_id, project_id, workspace_id, created_by, updated_by string
		var vote int
		var created_at, updated_at time.Time
		if err := rows.Scan(&id, &vote, &issue_id, &actor_id, &project_id, &workspace_id, &created_by, &updated_by, &created_at, &updated_at); err != nil {
			return nil, fmt.Errorf("scan issue vote: %w", err)
		}
		votes = append(votes, map[string]any{
			"id":         id,
			"vote":       vote,
			"issue":      issue_id,
			"actor":      actor_id,
			"project":    project_id,
			"workspace":  workspace_id,
			"created_by": created_by,
			"updated_by": updated_by,
			"created_at": created_at,
			"updated_at": updated_at,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error issue votes: %w", err)
	}
	return votes, nil
}

func (s PostgreSQLStore) GetWorkspaceProjectDeployBoards(ctx context.Context, slug string) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `SELECT p.id, p.identifier, p.name, p.description, p.emoji, p.icon_prop, p.cover_image
		FROM projects p
		JOIN workspaces w ON p.workspace_id = w.id
		JOIN deploy_boards d ON p.id = d.project_id
		WHERE w.slug = $1 AND d.entity_name = 'project' AND p.deleted_at IS NULL AND w.deleted_at IS NULL AND d.deleted_at IS NULL`, slug)
	if err != nil {
		return nil, fmt.Errorf("query workspace public projects: %w", err)
	}
	defer rows.Close()

	var projects []map[string]any
	for rows.Next() {
		var id, identifier, name, description string
		var emoji, cover_image *string
		var icon_prop map[string]any
		if err := rows.Scan(&id, &identifier, &name, &description, &emoji, &icon_prop, &cover_image); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		proj := map[string]any{
			"id":          id,
			"identifier":  identifier,
			"name":        name,
			"description": description,
			"icon_prop":   icon_prop,
		}
		if emoji != nil {
			proj["emoji"] = *emoji
		} else {
			proj["emoji"] = nil
		}
		if cover_image != nil {
			proj["cover_image"] = *cover_image
		} else {
			proj["cover_image"] = nil
		}
		projects = append(projects, proj)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return projects, nil
}
