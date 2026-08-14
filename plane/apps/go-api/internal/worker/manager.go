package worker

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

type Dispatcher interface {
	QueueName() string
	Process(ctx context.Context, job Job) error
}

type Manager struct {
	Logger      *slog.Logger
	Enabled     bool
	Store       Store
	Dispatchers []Dispatcher
	stop        chan struct{}
	wg          sync.WaitGroup
}

func NewManager(logger *slog.Logger, enabled bool, store Store) *Manager {
	return &Manager{
		Logger:  logger,
		Enabled: enabled,
		Store:   store,
		stop:    make(chan struct{}),
	}
}

func (m *Manager) Register(d Dispatcher) {
	m.Dispatchers = append(m.Dispatchers, d)
}

func (m *Manager) Start() {
	if !m.Enabled {
		m.Logger.Info("Go workers disabled (GO_WORKERS_ENABLED=false); Celery remains the job owner")
		return
	}
	m.Logger.Info("Go background workers started")
	for _, d := range m.Dispatchers {
		m.wg.Add(1)
		go m.poll(d)
	}
}

func (m *Manager) poll(d Dispatcher) {
	defer m.wg.Done()
	queueName := d.QueueName()
	m.Logger.Info("Polling queue started", "queue", queueName)

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-m.stop:
			m.Logger.Info("Polling queue stopped", "queue", queueName)
			return
		case <-ticker.C:
			m.processNextJob(d)
		}
	}
}

func (m *Manager) processNextJob(d Dispatcher) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	job, err := m.Store.Dequeue(ctx, d.QueueName())
	if err != nil {
		// pgx.ErrNoRows or custom wrapper means no pending job
		if err.Error() == "no rows in result set" {
			return
		}
		m.Logger.Error("failed to dequeue job", "queue", d.QueueName(), "error", err)
		return
	}

	m.Logger.Info("processing job", "queue", d.QueueName(), "id", job.ID)
	processErr := d.Process(ctx, job)
	
	if processErr != nil {
		m.Logger.Error("job failed", "queue", d.QueueName(), "id", job.ID, "error", processErr)
		if job.RetryCount < 3 {
			// Exponential backoff: 2^retry * 10 seconds
			backoff := time.Duration(1<<job.RetryCount) * 10 * time.Second
			_ = m.Store.UpdateStatus(ctx, job.ID, "failed", time.Now().Add(backoff), true)
		} else {
			_ = m.Store.UpdateStatus(ctx, job.ID, "dead_letter", time.Now(), false)
		}
	} else {
		m.Logger.Info("job completed", "queue", d.QueueName(), "id", job.ID)
		_ = m.Store.UpdateStatus(ctx, job.ID, "completed", time.Now(), false)
	}
}

func (m *Manager) Stop() {
	if !m.Enabled {
		return
	}
	close(m.stop)
	m.wg.Wait()
	m.Logger.Info("Go background workers stopped")
}
