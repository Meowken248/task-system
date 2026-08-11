package workspaceuserlink

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	payload WorkspaceUserLink
	err     error
}

func (s storeStub) ListForSession(ctx context.Context, sessionKey, slug string) ([]WorkspaceUserLink, error) {
	return []WorkspaceUserLink{s.payload}, s.err
}

func (s storeStub) GetForSession(ctx context.Context, sessionKey, slug, linkID string) (WorkspaceUserLink, error) {
	return s.payload, s.err
}

func (s storeStub) CreateForSession(ctx context.Context, sessionKey, slug string, payload WritePayload) (WorkspaceUserLink, error) {
	return s.payload, s.err
}

func (s storeStub) UpdateForSession(ctx context.Context, sessionKey, slug, linkID string, payload WritePayload) (WorkspaceUserLink, error) {
	return s.payload, s.err
}

func (s storeStub) DeleteForSession(ctx context.Context, sessionKey, slug, linkID string) error {
	return s.err
}

func TestListLinks(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/quick-links/", nil)
	req.SetPathValue("slug", "demo")
	res := httptest.NewRecorder()

	Handler{Store: storeStub{payload: WorkspaceUserLink{ID: "link-1"}}}.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestCreateLink(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/quick-links/", strings.NewReader(`{"url":"https://example.com"}`))
	req.SetPathValue("slug", "demo")
	res := httptest.NewRecorder()

	Handler{Store: storeStub{payload: WorkspaceUserLink{ID: "link-2"}}}.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("status=%d, want 201", res.Code)
	}
}

func TestErrors(t *testing.T) {
	tests := []struct {
		err  error
		want int
	}{
		{ErrUnauthorized, http.StatusUnauthorized},
		{ErrForbidden, http.StatusForbidden},
		{ErrNotFound, http.StatusNotFound},
		{ErrInvalid, http.StatusBadRequest},
	}

	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, "/quick-links/", nil)
		res := httptest.NewRecorder()
		Handler{Store: storeStub{err: tc.err}}.ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("err=%v status=%d, want %d", tc.err, res.Code, tc.want)
		}
	}
}
