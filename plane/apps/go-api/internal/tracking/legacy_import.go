package tracking

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

var legacyTrackingFiles = []string{
	"blockchain-data.json",
	"daily-reports.json",
	"task-assignments.json",
	"task-content.json",
}

type ImportStats struct {
	Files   int
	Records int
	Added   int
	Skipped int
}

// ImportLegacyJSON imports the old Django JSON tracking files into PostgreSQL.
// It is safe to call on every startup because the live unique indexes also
// protect imported transaction hashes and client event IDs.
func (s PostgreSQLStore) ImportLegacyJSON(ctx context.Context, directory string) (ImportStats, error) {
	var stats ImportStats
	if strings.TrimSpace(directory) == "" {
		return stats, nil
	}
	if s.Pool == nil {
		return stats, errors.New("tracking database unavailable")
	}
	records, files, err := readLegacyJSON(directory)
	if err != nil {
		return stats, err
	}
	stats.Files = files
	stats.Records = len(records)
	err = pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		for _, payload := range records {
			workspaceSlug := strings.TrimSpace(fmt.Sprint(payload["workspace_slug"]))
			projectID := strings.TrimSpace(fmt.Sprint(payload["project_id"]))
			issueID := strings.TrimSpace(fmt.Sprint(payload["issue_id"]))
			eventType := strings.TrimSpace(fmt.Sprint(payload["event_type"]))
			if workspaceSlug == "" || !uuidPattern.MatchString(projectID) || !uuidPattern.MatchString(issueID) || !supportedEvent(eventType) {
				stats.Skipped++
				continue
			}
			raw, marshalErr := json.Marshal(payload)
			if marshalErr != nil {
				stats.Skipped++
				continue
			}
			recordedAt := parseLegacyTime(payload["recorded_at"])
			transactionHash := normalizedOptional(payload["transaction_hash"])
			clientEventID := normalizedOptional(payload["client_event_id"])
			if clientEventID == "" {
				clientEventID = normalizedOptional(payload["client_report_id"])
			}
			onChain, _ := payload["on_chain"].(bool)
			verificationStatus := "not_requested"
			if onChain {
				verificationStatus = "verified"
			}
			persistenceStatus := strings.TrimSpace(fmt.Sprint(payload["persistence_status"]))
			if persistenceStatus == "" || persistenceStatus == "<nil>" {
				persistenceStatus = "committed"
			}
			command, execErr := tx.Exec(ctx, `INSERT INTO go_blockchain_events
				(workspace_slug, project_id, issue_id, event_type, transaction_hash, client_event_id,
				 on_chain, verification_status, persistence_status, payload, recorded_at)
				VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7, $8, $9, $10::jsonb, $11)
				ON CONFLICT DO NOTHING`,
				workspaceSlug, projectID, issueID, eventType, transactionHash, clientEventID,
				onChain, verificationStatus, persistenceStatus, raw, recordedAt)
			if execErr != nil {
				return execErr
			}
			if command.RowsAffected() == 0 {
				stats.Skipped++
			} else {
				stats.Added++
			}
		}
		return nil
	})
	return stats, err
}

func readLegacyJSON(directory string) ([]map[string]any, int, error) {
	records := make([]map[string]any, 0)
	files := 0
	for _, filename := range legacyTrackingFiles {
		path := filepath.Join(directory, filename)
		raw, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, files, fmt.Errorf("read legacy tracking file %s: %w", filename, err)
		}
		var fileRecords []map[string]any
		if err = json.Unmarshal(raw, &fileRecords); err != nil {
			return nil, files, fmt.Errorf("decode legacy tracking file %s: %w", filename, err)
		}
		files++
		records = append(records, fileRecords...)
	}
	return records, files, nil
}

func supportedEvent(eventType string) bool {
	switch eventType {
	case "create_task", "assign_task", "daily_report", "delete_task", "task_content":
		return true
	default:
		return false
	}
}

func normalizedOptional(value any) string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return strings.ToLower(text)
}

func parseLegacyTime(value any) time.Time {
	text := strings.TrimSpace(fmt.Sprint(value))
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.UTC()
		}
	}
	return time.Now().UTC()
}
