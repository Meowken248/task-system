package worker

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Job struct {
	ID         string
	QueueName  string
	Payload    []byte
	Status     string
	RetryCount int
	NextRunAt  time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type Store interface {
	Enqueue(ctx context.Context, queueName string, payload []byte) (Job, error)
	Dequeue(ctx context.Context, queueName string) (Job, error)
	UpdateStatus(ctx context.Context, id string, status string, nextRunAt time.Time, incrementRetry bool) error
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) Enqueue(ctx context.Context, queueName string, payload []byte) (Job, error) {
	var job Job
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO go_worker_jobs (queue_name, payload, status)
		VALUES ($1, $2, 'pending')
		RETURNING id::text, queue_name, payload, status, retry_count, next_run_at, created_at, updated_at
	`, queueName, payload).Scan(&job.ID, &job.QueueName, &job.Payload, &job.Status, &job.RetryCount, &job.NextRunAt, &job.CreatedAt, &job.UpdatedAt)
	return job, err
}

func (s PostgreSQLStore) Dequeue(ctx context.Context, queueName string) (Job, error) {
	var job Job
	// 1. Atomic claim with SELECT ... FOR UPDATE SKIP LOCKED
	// We only pick one pending or failed job whose next_run_at is in the past.
	err := s.Pool.QueryRow(ctx, `
		UPDATE go_worker_jobs 
		SET status = 'processing', updated_at = NOW()
		WHERE id = (
			SELECT id FROM go_worker_jobs 
			WHERE queue_name = $1 AND status IN ('pending', 'failed') AND next_run_at <= NOW()
			ORDER BY next_run_at ASC, created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING id::text, queue_name, payload, status, retry_count, next_run_at, created_at, updated_at
	`, queueName).Scan(&job.ID, &job.QueueName, &job.Payload, &job.Status, &job.RetryCount, &job.NextRunAt, &job.CreatedAt, &job.UpdatedAt)
	return job, err
}

func (s PostgreSQLStore) UpdateStatus(ctx context.Context, id string, status string, nextRunAt time.Time, incrementRetry bool) error {
	retryInc := 0
	if incrementRetry {
		retryInc = 1
	}
	_, err := s.Pool.Exec(ctx, `
		UPDATE go_worker_jobs
		SET status = $2, next_run_at = $3, retry_count = retry_count + $4, updated_at = NOW()
		WHERE id::text = $1
	`, id, status, nextRunAt, retryInc)
	return err
}
