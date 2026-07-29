package workspace

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

type listerStub struct {
	workspaces []map[string]any
	err        error
	session    string
	fields     []string
}

func (s *listerStub) ListForSession(_ context.Context, session string, fields []string) ([]map[string]any, error) {
	s.session, s.fields = session, fields
	return s.workspaces, s.err
}

func (s *listerStub) Create(_ context.Context, _ string, _ WorkspacePayload) (map[string]any, error) {
	return map[string]any{}, s.err
}

func (s *listerStub) Update(_ context.Context, _, _ string, _ map[string]any) (map[string]any, error) {
	return map[string]any{}, s.err
}

func (s *listerStub) Delete(_ context.Context, _, _ string) error {
	return s.err
}

func TestHandlerListsAuthenticatedUserWorkspaces(t *testing.T) {
	store := &listerStub{workspaces: []map[string]any{{"id": "workspace-id", "slug": "demo"}}}
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/workspaces/?fields=id,slug", nil)
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "valid-session"})
	res := httptest.NewRecorder()
	Handler{Store: store, SessionCookieName: "session-id"}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
	if store.session != "valid-session" || !reflect.DeepEqual(store.fields, []string{"id", "slug"}) {
		t.Fatalf("unexpected store call: session=%q fields=%v", store.session, store.fields)
	}
}

func TestHandlerRejectsUnauthenticatedSession(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/workspaces/", nil)
	res := httptest.NewRecorder()
	Handler{Store: &listerStub{err: ErrUnauthorized}}.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", res.Code)
	}
}

func TestHandlerReturnsServiceUnavailableOnStoreFailure(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/workspaces/", nil)
	res := httptest.NewRecorder()
	Handler{Store: &listerStub{err: errors.New("database down")}}.ServeHTTP(res, req)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", res.Code)
	}
}

func TestSelectFieldsUsesWhitelist(t *testing.T) {
	item := map[string]any{"id": "1", "slug": "demo", "secret": "hidden"}
	selected := selectFields(item, []string{"id", "secret"})
	if !reflect.DeepEqual(selected, map[string]any{"id": "1"}) {
		t.Fatalf("selected fields = %#v", selected)
	}
}
