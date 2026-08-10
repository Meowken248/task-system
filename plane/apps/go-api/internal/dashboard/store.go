package dashboard

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) GetWorkspaceDashboard(ctx context.Context, sessionKey, slug string, month int) (map[string]any, error) {
	if s.Pool == nil {
		return nil, fmt.Errorf("dashboard database unavailable")
	}

	// 1. Resolve User & Workspace Access
	var userID, workspaceID string
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text FROM sessions s
		JOIN workspaces w ON w.slug = $2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.member_id::text = s.user_id AND wm.is_active = TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key = $1 AND s.expire_date > NOW()`, sessionKey, slug).Scan(&userID, &workspaceID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Check if session is valid
			var valid bool
			_ = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key = $1 AND expire_date > NOW())`, sessionKey).Scan(&valid)
			if valid {
				return nil, ErrForbidden
			}
			return nil, ErrUnauthorized
		}
		return nil, err
	}

	// 2. Fetch Dashboard Data
	// For simplicity in the port, we will use individual queries similar to Django.
	// We could optimize this into fewer queries in the future, but we want parity first.

	// A. issue_activities (last 3 months)
	threeMonthsAgo := time.Now().AddDate(0, -3, 0).Truncate(24 * time.Hour)
	rows, err := s.Pool.Query(ctx, `
		SELECT DATE(created_at) AS created_date, COUNT(*) AS activity_count
		FROM issue_activities
		WHERE actor_id::text = $1 AND workspace_id::text = $2 AND created_at >= $3
		GROUP BY DATE(created_at)
		ORDER BY DATE(created_at)
	`, userID, workspaceID, threeMonthsAgo)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	issueActivities := make([]map[string]any, 0)
	for rows.Next() {
		var d time.Time
		var c int
		if err := rows.Scan(&d, &c); err == nil {
			issueActivities = append(issueActivities, map[string]any{"created_date": d.Format("2006-01-02"), "activity_count": c})
		}
	}

	// B. completed_issues (by week in the given month)
	rowsComp, err := s.Pool.Query(ctx, `
		SELECT 
			EXTRACT(WEEK FROM completed_at) - EXTRACT(WEEK FROM DATE_TRUNC('month', completed_at)) + 1 AS week_in_month,
			COUNT(i.id) AS completed_count
		FROM issues i
		JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		WHERE i.workspace_id::text = $2 AND i.completed_at IS NOT NULL AND EXTRACT(MONTH FROM i.completed_at) = $3 AND i.deleted_at IS NULL
		GROUP BY week_in_month
		ORDER BY week_in_month
	`, userID, workspaceID, month)
	if err != nil {
		return nil, err
	}
	defer rowsComp.Close()
	completedIssues := make([]map[string]any, 0)
	for rowsComp.Next() {
		var w float64
		var c int
		if err := rowsComp.Scan(&w, &c); err == nil {
			completedIssues = append(completedIssues, map[string]any{"week_in_month": int(w), "completed_count": c})
		}
	}

	// C. assigned_issues_count
	var assignedIssuesCount int
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(i.id)
		FROM issues i
		JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		WHERE i.workspace_id::text = $2 AND i.deleted_at IS NULL
	`, userID, workspaceID).Scan(&assignedIssuesCount)
	if err != nil {
		return nil, err
	}

	// D. pending_issues_count
	var pendingIssuesCount int
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(i.id)
		FROM issues i
		JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		JOIN states s ON s.id = i.state_id
		WHERE i.workspace_id::text = $2 AND s.group NOT IN ('completed', 'cancelled') AND i.deleted_at IS NULL
	`, userID, workspaceID).Scan(&pendingIssuesCount)
	if err != nil {
		return nil, err
	}

	// E. completed_issues_count
	var completedIssuesCount int
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(i.id)
		FROM issues i
		JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		JOIN states s ON s.id = i.state_id
		WHERE i.workspace_id::text = $2 AND s.group = 'completed' AND i.deleted_at IS NULL
	`, userID, workspaceID).Scan(&completedIssuesCount)
	if err != nil {
		return nil, err
	}

	// F. issues_due_week
	_, currentWeek := time.Now().ISOWeek()
	var issuesDueWeekCount int
	err = s.Pool.QueryRow(ctx, `
		SELECT COUNT(i.id)
		FROM issues i
		JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		WHERE i.workspace_id::text = $2 AND EXTRACT(WEEK FROM i.target_date) = $3 AND i.deleted_at IS NULL
	`, userID, workspaceID, currentWeek).Scan(&issuesDueWeekCount)
	if err != nil {
		return nil, err
	}

	// G. state_distribution
	rowsSD, err := s.Pool.Query(ctx, `
		SELECT s.group AS state_group, COUNT(i.id) AS state_count
		FROM issues i
		JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		JOIN states s ON s.id = i.state_id
		WHERE i.workspace_id::text = $2 AND i.deleted_at IS NULL
		GROUP BY s.group
		ORDER BY s.group
	`, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rowsSD.Close()
	stateDistribution := make([]map[string]any, 0)
	for rowsSD.Next() {
		var sg string
		var c int
		if err := rowsSD.Scan(&sg, &c); err == nil {
			stateDistribution = append(stateDistribution, map[string]any{"state_group": sg, "state_count": c})
		}
	}

	// H. overdue_issues
	rowsOI, err := s.Pool.Query(ctx, `
		SELECT i.id::text, i.name, w.slug, i.project_id::text, i.target_date
		FROM issues i
		JOIN workspaces w ON w.id = i.workspace_id
		JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		JOIN states s ON s.id = i.state_id
		WHERE i.workspace_id::text = $2 AND s.group NOT IN ('completed', 'cancelled') 
		  AND i.target_date < NOW() AND i.completed_at IS NULL AND i.deleted_at IS NULL
	`, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rowsOI.Close()
	overdueIssues := make([]map[string]any, 0)
	for rowsOI.Next() {
		var id, name, slugScan, projID string
		var targetDate *time.Time
		if err := rowsOI.Scan(&id, &name, &slugScan, &projID, &targetDate); err == nil {
			var tdStr *string
			if targetDate != nil {
				s := targetDate.Format("2006-01-02")
				tdStr = &s
			}
			overdueIssues = append(overdueIssues, map[string]any{
				"id":              id,
				"name":            name,
				"workspace__slug": slugScan,
				"project_id":      projID,
				"target_date":     tdStr,
			})
		}
	}

	// I. upcoming_issues
	rowsUI, err := s.Pool.Query(ctx, `
		SELECT i.id::text, i.name, w.slug, i.project_id::text, i.start_date
		FROM issues i
		JOIN workspaces w ON w.id = i.workspace_id
		JOIN issue_assignees ia ON ia.issue_id = i.id AND ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		JOIN states s ON s.id = i.state_id
		WHERE i.workspace_id::text = $2 AND s.group NOT IN ('completed', 'cancelled') 
		  AND i.start_date >= NOW() AND i.completed_at IS NULL AND i.deleted_at IS NULL
	`, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rowsUI.Close()
	upcomingIssues := make([]map[string]any, 0)
	for rowsUI.Next() {
		var id, name, slugScan, projID string
		var startDate *time.Time
		if err := rowsUI.Scan(&id, &name, &slugScan, &projID, &startDate); err == nil {
			var sdStr *string
			if startDate != nil {
				s := startDate.Format("2006-01-02")
				sdStr = &s
			}
			upcomingIssues = append(upcomingIssues, map[string]any{
				"id":              id,
				"name":            name,
				"workspace__slug": slugScan,
				"project_id":      projID,
				"start_date":      sdStr,
			})
		}
	}

	return map[string]any{
		"issue_activities":       issueActivities,
		"completed_issues":       completedIssues,
		"assigned_issues_count":  assignedIssuesCount,
		"pending_issues_count":   pendingIssuesCount,
		"completed_issues_count": completedIssuesCount,
		"issues_due_week_count":  issuesDueWeekCount,
		"state_distribution":     stateDistribution,
		"overdue_issues":         overdueIssues,
		"upcoming_issues":        upcomingIssues,
	}, nil
}
