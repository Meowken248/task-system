package search

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
)

type Store interface {
	GlobalSearch(ctx context.Context, sessionKey, workspaceSlug, query string) (map[string]interface{}, error)
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) GlobalSearch(ctx context.Context, sessionKey, workspaceSlug, query string) (map[string]interface{}, error) {
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM sessions session
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id=session.user_id
			AND wm.is_active=TRUE AND wm.deleted_at IS NULL
		WHERE session.session_key=$1 AND session.expire_date>NOW()
	)`, sessionKey, workspaceSlug).Scan(&allowed)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrForbidden
		}
		return nil, err
	}
	if !allowed {
		return nil, ErrForbidden
	}
	// A simplified global search returning basic objects matching the query
	// In a real application, you'd want to use PostgreSQL Full Text Search (tsvector)
	// For this milestone, we will use ILIKE on the most common tables.

	results := map[string]interface{}{
		"workspace":  []map[string]any{},
		"project":    []map[string]any{},
		"issue":      []map[string]any{},
		"cycle":      []map[string]any{},
		"module":     []map[string]any{},
		"issue_view": []map[string]any{},
		"page":       []map[string]any{},
		"intake":     []map[string]any{},
	}

	searchPattern := "%" + query + "%"

	// Search Projects
	projQuery := `
		SELECT p.id, p.name, p.identifier, w.slug
		FROM projects p
		JOIN workspaces w ON w.id = p.workspace_id
		WHERE w.slug = $1 AND p.deleted_at IS NULL AND p.archived_at IS NULL
		AND (p.name ILIKE $2 OR p.identifier ILIKE $2)
		LIMIT 10
	`
	rows, err := s.Pool.Query(ctx, projQuery, workspaceSlug, searchPattern)
	if err == nil {
		var projects []map[string]any
		for rows.Next() {
			var id, name, identifier, wslug string
			if err := rows.Scan(&id, &name, &identifier, &wslug); err == nil {
				projects = append(projects, map[string]any{
					"id":              id,
					"name":            name,
					"identifier":      identifier,
					"workspace__slug": wslug,
				})
			}
		}
		rows.Close()
		if projects != nil {
			results["project"] = projects
		}
	}

	// Search Issues
	issueQuery := `
		SELECT i.id, i.name, i.sequence_id, p.identifier, p.id, w.slug
		FROM issues i
		JOIN projects p ON p.id = i.project_id
		JOIN workspaces w ON w.id = i.workspace_id
		WHERE w.slug = $1 AND i.deleted_at IS NULL
		AND (i.name ILIKE $2)
		LIMIT 20
	`
	rows, err = s.Pool.Query(ctx, issueQuery, workspaceSlug, searchPattern)
	if err == nil {
		var issues []map[string]any
		for rows.Next() {
			var id, name, pidentifier, pid, wslug string
			var seqID int
			if err := rows.Scan(&id, &name, &seqID, &pidentifier, &pid, &wslug); err == nil {
				issues = append(issues, map[string]any{
					"id":                  id,
					"name":                name,
					"sequence_id":         seqID,
					"project__identifier": pidentifier,
					"project_id":          pid,
					"workspace__slug":     wslug,
				})
			}
		}
		rows.Close()
		if issues != nil {
			results["issue"] = issues
		}
	}

	return results, nil
}
