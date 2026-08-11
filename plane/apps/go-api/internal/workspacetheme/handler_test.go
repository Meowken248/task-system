package workspacetheme

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	payload WorkspaceTheme
	err     error
}

func (s storeStub) ListForSession(ctx context.Context, sessionKey, slug string) ([]WorkspaceTheme, error) {
	return []WorkspaceTheme{s.payload}, s.err
}

func (s storeStub) GetForSession(ctx context.Context, sessionKey, slug, themeID string) (WorkspaceTheme, error) {
	return s.payload, s.err
}

func (s storeStub) CreateForSession(ctx context.Context, sessionKey, slug string, payload WritePayload) (WorkspaceTheme, error) {
	return s.payload, s.err
}

func (s storeStub) UpdateForSession(ctx context.Context, sessionKey, slug, themeID string, payload WritePayload) (WorkspaceTheme, error) {
	return s.payload, s.err
}

func (s storeStub) DeleteForSession(ctx context.Context, sessionKey, slug, themeID string) error {
	return s.err
}

func TestListThemes(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/themes/", nil)
	req.SetPathValue("slug", "demo")
	res := httptest.NewRecorder()
	
	Handler{Store: storeStub{payload: WorkspaceTheme{ID: "theme-1"}}}.ServeHTTP(res, req)
	
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestCreateTheme(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/themes/", strings.NewReader(`{"name":"My Theme","colors":{"bg":"#000"}}`))
	req.SetPathValue("slug", "demo")
	res := httptest.NewRecorder()
	
	Handler{Store: storeStub{payload: WorkspaceTheme{ID: "theme-2"}}}.ServeHTTP(res, req)
	
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
		req := httptest.NewRequest(http.MethodGet, "/themes/", nil)
		res := httptest.NewRecorder()
		Handler{Store: storeStub{err: tc.err}}.ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("err=%v status=%d, want %d", tc.err, res.Code, tc.want)
		}
	}
}
