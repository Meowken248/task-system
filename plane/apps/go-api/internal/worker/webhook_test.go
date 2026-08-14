package worker_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/makeplane/plane/apps/go-api/internal/database"
	"github.com/makeplane/plane/apps/go-api/internal/worker"
)

func TestWorker_DispatchWebhook(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := database.Open(ctx, "postgresql://plane:plane@127.0.0.1:5432/plane_test_migrate?sslmode=disable")
	if err != nil {
		t.Skipf("failed to open database: %v", err)
	}
	defer pool.Close()

	if err := pool.Native().Ping(ctx); err != nil {
		t.Skipf("failed to ping database: %v", err)
	}

	// 1. Create a test HTTP server to act as the webhook receiver
	received := make(chan bool, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		received <- true
	}))
	defer ts.Close()

	// 2. Enqueue a job
	store := worker.PostgreSQLStore{Pool: pool.Native()}
	payloadData := worker.WebhookPayload{
		URL:     ts.URL,
		Payload: []byte(`{"test":"data"}`),
		Headers: map[string]string{"X-Test": "1"},
	}
	payloadBytes, _ := json.Marshal(payloadData)

	job, err := store.Enqueue(ctx, "webhook", payloadBytes)
	if err != nil {
		t.Fatalf("failed to enqueue: %v", err)
	}

	// 3. Process the job via Dispatcher
	dispatcher := worker.NewWebhookDispatcher()
	err = dispatcher.Process(ctx, job)
	if err != nil {
		t.Fatalf("dispatcher process failed: %v", err)
	}

	// 4. Verify HTTP server received the request
	select {
	case <-received:
		// OK
	case <-time.After(time.Second):
		t.Fatal("webhook server did not receive request")
	}
}
