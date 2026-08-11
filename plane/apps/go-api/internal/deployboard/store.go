package deployboard

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrForbidden = errors.New("forbidden")
	ErrNotFound  = errors.New("not found")
)

type DeployBoard struct {
	ID                 string         `json:"id"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
	WorkspaceID        string         `json:"workspace"`
	ProjectID          string         `json:"project"`
	EntityIdentifier   string         `json:"entity_identifier"`
	EntityName         string         `json:"entity_name"`
	Anchor             string         `json:"anchor"`
	IsCommentsEnabled  bool           `json:"is_comments_enabled"`
	IsReactionsEnabled bool           `json:"is_reactions_enabled"`
	IsVotesEnabled     bool           `json:"is_votes_enabled"`
	IsActivityEnabled  bool           `json:"is_activity_enabled"`
	IsDisabled         bool           `json:"is_disabled"`
	ViewProps          map[string]any `json:"view_props"`
	IntakeID           *string        `json:"intake"`
	CreatedBy          string         `json:"created_by"`
	UpdatedBy          string         `json:"updated_by"`
}

type Store interface {
	GetProjectDeployBoard(ctx context.Context, sessionKey, slug, projectID string) (DeployBoard, error)
	SaveProjectDeployBoard(ctx context.Context, sessionKey, slug, projectID string, payload map[string]any) (DeployBoard, error)
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

type resolvedContext struct {
	WorkspaceID string
	ProjectID   string
	UserID      string
}

func (s PostgreSQLStore) resolveContext(ctx context.Context, sessionKey, slug, projectID string) (resolvedContext, error) {
	var rc resolvedContext
	err := s.Pool.QueryRow(ctx, `
		SELECT p.workspace_id, p.id, s.user_id 
		FROM projects p
		JOIN workspaces w ON p.workspace_id = w.id
		JOIN sessions s ON s.session_key = $1
		WHERE w.slug = $2 AND p.id::text = $3 AND p.deleted_at IS NULL AND w.deleted_at IS NULL
	`, sessionKey, slug, projectID).Scan(&rc.WorkspaceID, &rc.ProjectID, &rc.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return rc, ErrForbidden
		}
		return rc, fmt.Errorf("resolve context: %w", err)
	}

	var isActive bool
	err = s.Pool.QueryRow(ctx, `
		SELECT is_active FROM project_members 
		WHERE project_id = $1 AND member_id = $2 AND deleted_at IS NULL
	`, rc.ProjectID, rc.UserID).Scan(&isActive)
	if err != nil || !isActive {
		return rc, ErrForbidden
	}

	return rc, nil
}

func (s PostgreSQLStore) GetProjectDeployBoard(ctx context.Context, sessionKey, slug, projectID string) (DeployBoard, error) {
	var board DeployBoard

	rc, err := s.resolveContext(ctx, sessionKey, slug, projectID)
	if err != nil {
		return board, err
	}

	err = s.Pool.QueryRow(ctx, `
		SELECT id, created_at, updated_at, workspace_id, project_id, entity_identifier, entity_name, anchor, 
		       is_comments_enabled, is_reactions_enabled, is_votes_enabled, is_activity_enabled, is_disabled, 
		       view_props, intake_id, created_by_id, updated_by_id
		FROM deploy_boards
		WHERE entity_name = 'project' AND entity_identifier::text = $1 AND workspace_id = $2 AND deleted_at IS NULL
	`, rc.ProjectID, rc.WorkspaceID).Scan(
		&board.ID, &board.CreatedAt, &board.UpdatedAt, &board.WorkspaceID, &board.ProjectID, &board.EntityIdentifier, &board.EntityName, &board.Anchor,
		&board.IsCommentsEnabled, &board.IsReactionsEnabled, &board.IsVotesEnabled, &board.IsActivityEnabled, &board.IsDisabled,
		&board.ViewProps, &board.IntakeID, &board.CreatedBy, &board.UpdatedBy,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DeployBoard{}, nil // Django returns empty serializer (null fields essentially)
		}
		return board, fmt.Errorf("get deploy board: %w", err)
	}

	return board, nil
}

func (s PostgreSQLStore) SaveProjectDeployBoard(ctx context.Context, sessionKey, slug, projectID string, payload map[string]any) (DeployBoard, error) {
	var board DeployBoard

	rc, err := s.resolveContext(ctx, sessionKey, slug, projectID)
	if err != nil {
		return board, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return board, fmt.Errorf("begin save deploy board: %w", err)
	}
	defer tx.Rollback(ctx)

	var existingID string
	var viewProps map[string]any
	var isCommentsEnabled, isReactionsEnabled, isVotesEnabled bool
	var intakeID *string

	err = tx.QueryRow(ctx, `
		SELECT id, view_props, is_comments_enabled, is_reactions_enabled, is_votes_enabled, intake_id
		FROM deploy_boards
		WHERE entity_name = 'project' AND entity_identifier::text = $1 AND workspace_id = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, rc.ProjectID, rc.WorkspaceID).Scan(&existingID, &viewProps, &isCommentsEnabled, &isReactionsEnabled, &isVotesEnabled, &intakeID)

	isNew := false
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			isNew = true
		} else {
			return board, fmt.Errorf("lock deploy board: %w", err)
		}
	}

	if isNew {
		viewProps = map[string]any{
			"list":        true,
			"kanban":      true,
			"calendar":    true,
			"gantt":       true,
			"spreadsheet": true,
		}
	}

	if val, ok := payload["is_comments_enabled"].(bool); ok {
		isCommentsEnabled = val
	}
	if val, ok := payload["is_reactions_enabled"].(bool); ok {
		isReactionsEnabled = val
	}
	if val, ok := payload["is_votes_enabled"].(bool); ok {
		isVotesEnabled = val
	}
	if val, ok := payload["views"].(map[string]any); ok {
		viewProps = val
	}
	if intakeRaw, ok := payload["intake"]; ok {
		if intakeStr, ok := intakeRaw.(string); ok && intakeStr != "" {
			intakeID = &intakeStr
		} else if intakeRaw == nil {
			intakeID = nil
		}
	}

	if isNew {
		err = tx.QueryRow(ctx, `
			INSERT INTO deploy_boards (
				workspace_id, project_id, entity_name, entity_identifier, anchor,
				is_comments_enabled, is_reactions_enabled, is_votes_enabled, view_props, intake_id,
				created_by_id, updated_by_id, created_at, updated_at
			) VALUES (
				$1, $2, 'project', $2, md5(random()::text),
				$3, $4, $5, $6, $7,
				$8, $8, NOW(), NOW()
			) RETURNING id
		`, rc.WorkspaceID, rc.ProjectID, isCommentsEnabled, isReactionsEnabled, isVotesEnabled, viewProps, intakeID, rc.UserID).Scan(&existingID)
		if err != nil {
			return board, fmt.Errorf("insert deploy board: %w", err)
		}
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE deploy_boards SET
				is_comments_enabled = $1, is_reactions_enabled = $2, is_votes_enabled = $3,
				view_props = $4, intake_id = $5, updated_by_id = $6, updated_at = NOW()
			WHERE id = $7
		`, isCommentsEnabled, isReactionsEnabled, isVotesEnabled, viewProps, intakeID, rc.UserID, existingID)
		if err != nil {
			return board, fmt.Errorf("update deploy board: %w", err)
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return board, fmt.Errorf("commit save deploy board: %w", err)
	}

	return s.GetProjectDeployBoard(ctx, sessionKey, slug, projectID)
}
