package webhook

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeStore struct {
	result Webhook
	logs   []Log
	err    error
	called string
	input  Input
}

func (f *fakeStore) List(context.Context, string, string) ([]Webhook, error) {
	f.called = "list"
	return []Webhook{f.result}, f.err
}
func (f *fakeStore) Get(context.Context, string, string, string, bool) (Webhook, error) {
	f.called = "get"
	return f.result, f.err
}
func (f *fakeStore) Create(_ context.Context, _, _ string, in Input) (Webhook, error) {
	f.called = "create"
	f.input = in
	return f.result, f.err
}
func (f *fakeStore) Update(_ context.Context, _, _, _ string, in Input) (Webhook, error) {
	f.called = "update"
	f.input = in
	return f.result, f.err
}
func (f *fakeStore) Delete(context.Context, string, string, string) error {
	f.called = "delete"
	return f.err
}
func (f *fakeStore) Regenerate(context.Context, string, string, string) (Webhook, error) {
	f.called = "regenerate"
	return f.result, f.err
}
func (f *fakeStore) Logs(context.Context, string, string, string) ([]Log, error) {
	f.called = "logs"
	return f.logs, f.err
}

func TestCreateWebhookReturnsSecret(t *testing.T) {
	store := &fakeStore{result: Webhook{ID: "hook-1", URL: "https://hooks.example.com/events", SecretKey: "plane_wh_secret"}}
	r := httptest.NewRequest(http.MethodPost, "/api/workspaces/acme/webhooks/", strings.NewReader(`{"url":"https://hooks.example.com/events","issue":true}`))
	r.SetPathValue("slug", "acme")
	r.AddCookie(&http.Cookie{Name: "session-id", Value: "session"})
	w := httptest.NewRecorder()
	Handler{Store: store, AllowedHosts: []string{"hooks.example.com"}}.ServeHTTP(w, r)
	if w.Code != http.StatusCreated || store.called != "create" || store.input.Issue == nil || !*store.input.Issue {
		t.Fatalf("code=%d called=%s body=%s", w.Code, store.called, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "plane_wh_secret") {
		t.Fatalf("secret missing: %s", w.Body.String())
	}
}

func TestRejectsLocalWebhookURL(t *testing.T) {
	store := &fakeStore{}
	r := httptest.NewRequest(http.MethodPost, "/api/workspaces/acme/webhooks/", strings.NewReader(`{"url":"http://127.0.0.1/hook"}`))
	r.SetPathValue("slug", "acme")
	w := httptest.NewRecorder()
	Handler{Store: store}.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest || store.called != "" {
		t.Fatalf("code=%d called=%s body=%s", w.Code, store.called, w.Body.String())
	}
}

func TestWebhookErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want int
	}{{ErrUnauthorized, 401}, {ErrForbidden, 403}, {ErrNotFound, 404}, {ErrConflict, 409}, {errors.New("db"), 503}} {
		store := &fakeStore{err: tc.err}
		r := httptest.NewRequest(http.MethodGet, "/api/workspaces/acme/webhooks/", nil)
		r.SetPathValue("slug", "acme")
		w := httptest.NewRecorder()
		Handler{Store: store}.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Errorf("err=%v code=%d want=%d", tc.err, w.Code, tc.want)
		}
	}
}

func TestWebhookLogsRoute(t *testing.T) {
	store := &fakeStore{logs: []Log{{ID: "log-1", Webhook: "hook-1"}}}
	r := httptest.NewRequest(http.MethodGet, "/api/workspaces/acme/webhook-logs/hook-1/", nil)
	r.SetPathValue("slug", "acme")
	r.SetPathValue("webhook_id", "hook-1")
	w := httptest.NewRecorder()
	Handler{Store: store}.ServeHTTP(w, r)
	if w.Code != 200 || store.called != "logs" || !strings.Contains(w.Body.String(), "log-1") {
		t.Fatalf("code=%d called=%s body=%s", w.Code, store.called, w.Body.String())
	}
}
