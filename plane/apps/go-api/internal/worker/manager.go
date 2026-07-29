package worker

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Manager struct {
	Pool   *pgxpool.Pool
	Logger *slog.Logger
	stop   chan struct{}
}

func NewManager(pool *pgxpool.Pool, logger *slog.Logger) *Manager {
	return &Manager{
		Pool:   pool,
		Logger: logger,
		stop:   make(chan struct{}),
	}
}

func (m *Manager) Start() {
	m.Logger.Info("Background worker started")
	go m.processWebhooks()
	go m.processEmails()
}

func (m *Manager) Stop() {
	close(m.stop)
	m.Logger.Info("Background worker stopped")
}

func (m *Manager) processWebhooks() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			// Query webhook_logs where response_status IS NULL (pending webhooks)
			query := `
				SELECT id, webhook, request_body, event_type, retry_count
				FROM webhook_logs
				WHERE response_status IS NULL AND retry_count < 3
				LIMIT 10
			`
			rows, err := m.Pool.Query(ctx, query)
			if err == nil {
				var ids []string
				for rows.Next() {
					var id, webhook, body, event string
					var retry int
					if err := rows.Scan(&id, &webhook, &body, &event, &retry); err == nil {
						ids = append(ids, id)
					}
				}
				rows.Close()

				// Mock processing
				for _, id := range ids {
					m.Logger.Info("Processing webhook", "id", id)
					_, _ = m.Pool.Exec(ctx, `UPDATE webhook_logs SET response_status = '200' WHERE id = $1`, id)
				}
			} else {
				m.Logger.Error("Failed to query webhook_logs", "error", err)
			}
			cancel()
		}
	}
}

func (m *Manager) processEmails() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			// Query email_notification_logs where sent_at IS NULL
			query := `
				SELECT id, receiver_id, entity, entity_name
				FROM email_notification_logs
				WHERE sent_at IS NULL
				LIMIT 10
			`
			rows, err := m.Pool.Query(ctx, query)
			if err == nil {
				var ids []string
				for rows.Next() {
					var id, receiverID, entity, entityName string
					if err := rows.Scan(&id, &receiverID, &entity, &entityName); err == nil {
						ids = append(ids, id)
					}
				}
				rows.Close()

				// Mock processing
				for _, id := range ids {
					m.Logger.Info("Sending email", "log_id", id)
					_, _ = m.Pool.Exec(ctx, `UPDATE email_notification_logs SET sent_at = NOW(), processed_at = NOW() WHERE id = $1`, id)
				}
			} else {
				m.Logger.Error("Failed to query email_notification_logs", "error", err)
			}
			cancel()
		}
	}
}
