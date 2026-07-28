package tracking

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized    = errors.New("authentication required")
	ErrForbidden       = errors.New("permission denied")
	ErrInvalidProgress = errors.New("progress must be between 0 and 100")
	ErrConflict        = errors.New("transaction is linked to another event")
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) RecordVerified(ctx context.Context, sessionKey, workspaceSlug, projectID string, payload map[string]any) (map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("tracking database unavailable")
	}
	var result map[string]any
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		userID, err := authenticatedUser(ctx, tx, sessionKey)
		if err != nil {
			return err
		}
		if err = authorizeEvent(ctx, tx, userID, workspaceSlug, projectID, payload); err != nil {
			return err
		}
		if err = applyEventSideEffects(ctx, tx, userID, workspaceSlug, projectID, payload); err != nil {
			return err
		}
		now := time.Now().UTC()
		payload["workspace_slug"] = workspaceSlug
		payload["project_id"] = projectID
		payload["on_chain"] = true
		payload["verification_status"] = "verified"
		payload["persistence_status"] = "committed"
		payload["recorded_at"] = now.Format(time.RFC3339Nano)
		if payload["event_type"] == "daily_report" && emptyStoreValue(payload["report_id"]) {
			reportID, uuidErr := newUUID()
			if uuidErr != nil {
				return uuidErr
			}
			payload["report_id"] = reportID
		}
		raw, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			return marshalErr
		}
		txHash := strings.ToLower(fmt.Sprint(payload["transaction_hash"]))
		command, insertErr := tx.Exec(ctx, `INSERT INTO go_blockchain_events
			(workspace_slug, project_id, issue_id, event_type, transaction_hash, on_chain, verification_status, persistence_status, payload, recorded_at)
			VALUES ($1, $2, $3, $4, $5, TRUE, 'verified', 'committed', $6::jsonb, $7)
			ON CONFLICT DO NOTHING`, workspaceSlug, projectID, fmt.Sprint(payload["issue_id"]), fmt.Sprint(payload["event_type"]), txHash, raw, now)
		if insertErr != nil {
			return insertErr
		}
		if command.RowsAffected() == 0 {
			var existingRaw []byte
			lookupErr := tx.QueryRow(ctx, `SELECT payload FROM go_blockchain_events WHERE LOWER(transaction_hash) = $1`, txHash).Scan(&existingRaw)
			if lookupErr != nil {
				return ErrConflict
			}
			var existing map[string]any
			if json.Unmarshal(existingRaw, &existing) != nil || fmt.Sprint(existing["event_type"]) != fmt.Sprint(payload["event_type"]) || fmt.Sprint(existing["issue_id"]) != fmt.Sprint(payload["issue_id"]) {
				return ErrConflict
			}
			result = existing
			return nil
		}
		result = payload
		return nil
	})
	return result, err
}

func authorizeEvent(ctx context.Context, tx pgx.Tx, userID, slug, projectID string, payload map[string]any) error {
	eventType := fmt.Sprint(payload["event_type"])
	issueID := fmt.Sprint(payload["issue_id"])
	switch eventType {
	case "create_task", "assign_task", "delete_task":
		return requireProjectAdmin(ctx, tx, userID, slug, projectID)
	case "daily_report":
		if _, err := parseProgress(payload["progress"]); err != nil {
			return err
		}
		return requireIssueAssignee(ctx, tx, userID, slug, projectID, issueID)
	case "task_content":
		if err := requireProjectAdmin(ctx, tx, userID, slug, projectID); err == nil {
			return nil
		}
		return requireIssueAssignee(ctx, tx, userID, slug, projectID, issueID)
	default:
		return errors.New("unsupported event")
	}
}

func applyEventSideEffects(ctx context.Context, tx pgx.Tx, userID, slug, projectID string, payload map[string]any) error {
	eventType := fmt.Sprint(payload["event_type"])
	issueID := fmt.Sprint(payload["issue_id"])
	switch eventType {
	case "assign_task":
		assigneeID := fmt.Sprint(payload["assignee_id"])
		var workspaceID, assigneeName string
		err := tx.QueryRow(ctx, `SELECT i.workspace_id::text
			FROM issues i JOIN workspaces w ON w.id = i.workspace_id
			WHERE i.id::text = $1 AND i.project_id::text = $2 AND w.slug = $3 AND i.deleted_at IS NULL
			AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = i.project_id AND pm.member_id::text = $4 AND pm.is_active = TRUE AND pm.deleted_at IS NULL)`,
			issueID, projectID, slug, assigneeID).Scan(&workspaceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("task or employee was not found")
		}
		if err != nil {
			return err
		}
		if err = tx.QueryRow(ctx, `SELECT COALESCE(NULLIF(display_name, ''), email, id::text) FROM users WHERE id::text = $1`, assigneeID).Scan(&assigneeName); err != nil {
			return err
		}
		payload["assignee_name"] = assigneeName
		_, err = tx.Exec(ctx, `UPDATE issue_assignees SET deleted_at = NOW(), updated_at = NOW(), updated_by_id = $1
			WHERE issue_id::text = $2 AND assignee_id::text <> $3 AND deleted_at IS NULL`, userID, issueID, assigneeID)
		if err != nil {
			return err
		}
		assignmentID, uuidErr := newUUID()
		if uuidErr != nil {
			return uuidErr
		}
		_, err = tx.Exec(ctx, `INSERT INTO issue_assignees
			(id, created_at, updated_at, created_by_id, updated_by_id, workspace_id, project_id, issue_id, assignee_id)
			SELECT $1, NOW(), NOW(), $2, $2, $3, $4, $5, $6
			WHERE NOT EXISTS (SELECT 1 FROM issue_assignees WHERE issue_id::text = $5 AND assignee_id::text = $6 AND deleted_at IS NULL)`,
			assignmentID, userID, workspaceID, projectID, issueID, assigneeID)
		return err
	case "delete_task":
		if _, err := tx.Exec(ctx, `UPDATE issues SET parent_id = NULL, updated_at = NOW(), updated_by_id = $1 WHERE parent_id::text = $2 AND deleted_at IS NULL`, userID, issueID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE issues SET deleted_at = NOW(), updated_at = NOW(), updated_by_id = $1
			WHERE id::text = $2 AND project_id::text = $3 AND workspace_id = (SELECT id FROM workspaces WHERE slug = $4 AND deleted_at IS NULL) AND deleted_at IS NULL`, userID, issueID, projectID, slug)
		return err
	case "daily_report":
		progress, err := parseProgress(payload["progress"])
		if err != nil {
			return err
		}
		payload["progress"] = progress
		payload["reporter_id"] = userID
		var reporterName string
		if err = tx.QueryRow(ctx, `SELECT COALESCE(NULLIF(display_name, ''), email, id::text) FROM users WHERE id::text = $1`, userID).Scan(&reporterName); err != nil {
			return err
		}
		payload["reporter_name"] = reporterName
		return updateIssueProgressState(ctx, tx, projectID, issueID, progress)
	default:
		return nil
	}
}

func (s PostgreSQLStore) List(ctx context.Context, workspaceSlug, projectID, assigneeID string) ([]map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("tracking database unavailable")
	}
	query := `SELECT payload FROM go_blockchain_events
		WHERE workspace_slug = $1 AND project_id = $2
		AND ($3 = '' OR payload->>'assignee_id' = $3 OR payload->>'reporter_id' = $3)
		ORDER BY recorded_at ASC, id ASC`
	rows, err := s.Pool.Query(ctx, query, workspaceSlug, projectID, assigneeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := make([]map[string]any, 0)
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		var record map[string]any
		if err = json.Unmarshal(raw, &record); err != nil {
			return nil, fmt.Errorf("decode tracking payload: %w", err)
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s PostgreSQLStore) RecordOffline(ctx context.Context, sessionKey, workspaceSlug, projectID string, payload map[string]any) (map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("tracking database unavailable")
	}
	var result map[string]any
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		userID, err := authenticatedUser(ctx, tx, sessionKey)
		if err != nil {
			return err
		}
		eventType, _ := payload["event_type"].(string)
		issueID := fmt.Sprint(payload["issue_id"])
		switch eventType {
		case "create_task":
			if err = requireProjectAdmin(ctx, tx, userID, workspaceSlug, projectID); err != nil {
				return err
			}
		case "daily_report":
			progress, parseErr := parseProgress(payload["progress"])
			if parseErr != nil {
				return parseErr
			}
			if err = requireIssueAssignee(ctx, tx, userID, workspaceSlug, projectID, issueID); err != nil {
				return err
			}
			payload["progress"] = progress
			payload["reporter_id"] = userID
			var reporterName string
			if err = tx.QueryRow(ctx, `SELECT COALESCE(NULLIF(display_name, ''), email, id::text) FROM users WHERE id::text = $1`, userID).Scan(&reporterName); err != nil {
				return err
			}
			payload["reporter_name"] = reporterName
			payload["report_id"] = fmt.Sprint(payload["client_event_id"])
			if err = updateIssueProgressState(ctx, tx, projectID, issueID, progress); err != nil {
				return err
			}
		default:
			return errors.New("unsupported offline event")
		}

		now := time.Now().UTC()
		payload["workspace_slug"] = workspaceSlug
		payload["project_id"] = projectID
		payload["on_chain"] = false
		payload["verification_status"] = "not_requested"
		payload["persistence_status"] = "committed"
		payload["recorded_at"] = now.Format(time.RFC3339Nano)
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		clientEventID := fmt.Sprint(payload["client_event_id"])
		_, err = tx.Exec(ctx, `INSERT INTO go_blockchain_events
			(workspace_slug, project_id, issue_id, event_type, client_event_id, on_chain, payload, recorded_at)
			VALUES ($1, $2, $3, $4, $5, FALSE, $6::jsonb, $7)
			ON CONFLICT (workspace_slug, project_id, client_event_id)
			WHERE client_event_id IS NOT NULL AND client_event_id <> ''
			DO UPDATE SET payload = EXCLUDED.payload, recorded_at = EXCLUDED.recorded_at`,
			workspaceSlug, projectID, issueID, eventType, clientEventID, raw, now)
		if err != nil {
			return err
		}
		result = payload
		return nil
	})
	return result, err
}

func authenticatedUser(ctx context.Context, tx pgx.Tx, sessionKey string) (string, error) {
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var userID string
	err := tx.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key = $1 AND expire_date > NOW()`, sessionKey).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) || userID == "" {
		return "", ErrUnauthorized
	}
	return userID, err
}

func requireProjectAdmin(ctx context.Context, tx pgx.Tx, userID, slug, projectID string) error {
	var allowed bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM project_members pm
		JOIN projects p ON p.id = pm.project_id AND p.deleted_at IS NULL
		JOIN workspaces w ON w.id = p.workspace_id AND w.deleted_at IS NULL
		WHERE pm.project_id::text = $1 AND pm.member_id::text = $2 AND w.slug = $3
		AND pm.is_active = TRUE AND pm.deleted_at IS NULL AND pm.role = 20
	)`, projectID, userID, slug).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrForbidden
	}
	return nil
}

func requireIssueAssignee(ctx context.Context, tx pgx.Tx, userID, slug, projectID, issueID string) error {
	var allowed bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM issue_assignees ia
		JOIN issues i ON i.id = ia.issue_id AND i.deleted_at IS NULL
		JOIN workspaces w ON w.id = i.workspace_id AND w.deleted_at IS NULL
		WHERE ia.assignee_id::text = $1 AND ia.deleted_at IS NULL
		AND i.id::text = $2 AND i.project_id::text = $3 AND w.slug = $4
	)`, userID, issueID, projectID, slug).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrForbidden
	}
	return nil
}

func updateIssueProgressState(ctx context.Context, tx pgx.Tx, projectID, issueID string, progress int) error {
	groups := []string{"started"}
	if progress == 0 {
		groups = []string{"backlog", "unstarted"}
	} else if progress == 100 {
		groups = []string{"completed"}
	}
	var stateID string
	err := tx.QueryRow(ctx, `SELECT id::text FROM states
		WHERE project_id::text = $1 AND deleted_at IS NULL AND "group" = ANY($2)
		ORDER BY sequence ASC LIMIT 1`, projectID, groups).Scan(&stateID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE issues SET state_id = $1, updated_at = NOW() WHERE id::text = $2 AND project_id::text = $3`, stateID, issueID, projectID)
	return err
}

func parseProgress(value any) (int, error) {
	var progress int
	switch typed := value.(type) {
	case float64:
		progress = int(typed)
	case int:
		progress = typed
	case string:
		parsed, err := strconv.Atoi(typed)
		if err != nil {
			return 0, ErrInvalidProgress
		}
		progress = parsed
	default:
		return 0, ErrInvalidProgress
	}
	if progress < 0 || progress > 100 {
		return 0, ErrInvalidProgress
	}
	return progress, nil
}

func newUUID() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate UUID: %w", err)
	}
	buffer[6] = (buffer[6] & 0x0f) | 0x40
	buffer[8] = (buffer[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(buffer)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}

func emptyStoreValue(value any) bool {
	text := fmt.Sprint(value)
	return value == nil || text == "" || text == "<nil>"
}
