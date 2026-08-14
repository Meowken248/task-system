package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type WebhookPayload struct {
	URL     string `json:"url"`
	Payload []byte `json:"payload"`
	Headers map[string]string `json:"headers"`
}

type WebhookDispatcher struct {
	client *http.Client
}

func NewWebhookDispatcher() *WebhookDispatcher {
	return &WebhookDispatcher{
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (d *WebhookDispatcher) QueueName() string {
	return "webhook"
}

func (d *WebhookDispatcher) Process(ctx context.Context, job Job) error {
	var payload WebhookPayload
	if err := json.Unmarshal(job.Payload, &payload); err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, payload.URL, bytes.NewReader(payload.Payload))
	if err != nil {
		return err
	}
	
	req.Header.Set("Content-Type", "application/json")
	for k, v := range payload.Headers {
		req.Header.Set(k, v)
	}

	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned non-success status code: %d", resp.StatusCode)
	}
	
	return nil
}
