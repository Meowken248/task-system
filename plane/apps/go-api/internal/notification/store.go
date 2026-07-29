package notification

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Notification struct {
	ID               string                 `json:"id"`
	WorkspaceID      string                 `json:"workspace"`
	ProjectID        *string                `json:"project"`
	Data             map[string]interface{} `json:"data"`
	EntityIdentifier *string                `json:"entity_identifier"`
	EntityName       string                 `json:"entity_name"`
	Title            string                 `json:"title"`
	Message          map[string]interface{} `json:"message"`
	MessageHTML      string                 `json:"message_html"`
	MessageStripped  *string                `json:"message_stripped"`
	Sender           string                 `json:"sender"`
	TriggeredByID    *string                `json:"triggered_by"`
	ReceiverID       string                 `json:"receiver"`
	ReadAt           *time.Time             `json:"read_at"`
	SnoozedTill      *time.Time             `json:"snoozed_till"`
	ArchivedAt       *time.Time             `json:"archived_at"`
	CreatedAt        time.Time              `json:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at"`
}

type Store interface {
	ListNotifications(ctx context.Context, receiverID string, workspaceID string) ([]Notification, error)
	MarkAsRead(ctx context.Context, receiverID string, notificationID string) error
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) ListNotifications(ctx context.Context, receiverID string, workspaceID string) ([]Notification, error) {
	query := `
		SELECT 
			id, workspace_id, project_id, data, entity_identifier, entity_name,
			title, message, message_html, message_stripped, sender, triggered_by_id,
			receiver_id, read_at, snoozed_till, archived_at, created_at, updated_at
		FROM notifications
		WHERE receiver_id = $1 AND workspace_id = $2 AND archived_at IS NULL
		ORDER BY created_at DESC
		LIMIT 50
	`
	rows, err := s.Pool.Query(ctx, query, receiverID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []Notification
	for rows.Next() {
		var n Notification
		err := rows.Scan(
			&n.ID, &n.WorkspaceID, &n.ProjectID, &n.Data, &n.EntityIdentifier, &n.EntityName,
			&n.Title, &n.Message, &n.MessageHTML, &n.MessageStripped, &n.Sender, &n.TriggeredByID,
			&n.ReceiverID, &n.ReadAt, &n.SnoozedTill, &n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		results = append(results, n)
	}
	if results == nil {
		results = []Notification{}
	}
	return results, nil
}

func (s PostgreSQLStore) MarkAsRead(ctx context.Context, receiverID string, notificationID string) error {
	query := `
		UPDATE notifications
		SET read_at = NOW(), updated_at = NOW()
		WHERE receiver_id = $1 AND id = $2
	`
	_, err := s.Pool.Exec(ctx, query, receiverID, notificationID)
	return err
}
