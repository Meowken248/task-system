package state

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readerStub struct {
	items []map[string]any
	item  map[string]any
	err   error
}

func (s readerStub) ListForSession(context.Context, string, string, string) ([]map[string]any, error) {
	return s.items, s.err
}

func (s readerStub) GetForSession(context.Context, string, string, string, string) (map[string]any, error) {
	return s.item, s.err
}
func (s readerStub) CreateForSession(context.Context, string, string, string, WritePayload) (map[string]any, error) {
	return s.item, s.err
}
func (s readerStub) UpdateForSession(context.Context, string, string, string, string, WritePayload) (map[string]any, error) {
	return s.item, s.err
}
func (s readerStub) DeleteForSession(context.Context, string, string, string, string) error {
	return s.err
}

func TestListStates(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/states/", nil)
	req.SetPathValue("slug", "demo")
	req.SetPathValue("project_id", "project-1")
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "session"})
	res := httptest.NewRecorder()
	Handler{
		Store:             readerStub{items: []map[string]any{{"id": "state-1", "group": "backlog"}}},
		SessionCookieName: "session-id",
	}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestGroupedStates(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/states/?grouped=true", nil)
	res := httptest.NewRecorder()
	Handler{Store: readerStub{items: []map[string]any{{"id": "state-1", "group": "started"}}}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("response=%d %s", res.Code, res.Body.String())
	}
}

func TestStateErrors(t *testing.T) {
	tests := []struct {
		err  error
		want int
	}{{ErrUnauthorized, http.StatusUnauthorized}, {ErrForbidden, http.StatusForbidden}, {ErrNotFound, http.StatusNotFound}, {errors.New("database down"), http.StatusServiceUnavailable}}
	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, "/states/state-1/", nil)
		req.SetPathValue("state_id", "state-1")
		res := httptest.NewRecorder()
		Handler{Store: readerStub{err: tc.err}}.ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("err=%v status=%d, want %d", tc.err, res.Code, tc.want)
		}
	}
}
