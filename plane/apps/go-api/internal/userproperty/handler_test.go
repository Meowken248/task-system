package userproperty

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	getResult   map[string]any
	patchResult map[string]any
	err         error
	scope       Scope
	entityID    string
	patch       map[string]any
}

func (s *storeStub) GetForSession(_ context.Context, _, _, _ string, scope Scope, entityID string) (map[string]any, error) {
	s.scope, s.entityID = scope, entityID
	return s.getResult, s.err
}

func (s *storeStub) PatchForSession(_ context.Context, _, _, _ string, scope Scope, entityID string, patch map[string]any) (map[string]any, error) {
	s.scope, s.entityID, s.patch = scope, entityID, patch
	return s.patchResult, s.err
}

func TestProjectPropertiesGet(t *testing.T) {
	store := &storeStub{getResult: map[string]any{"project": "project-1"}}
	handler := Handler{Store: store, SessionCookieName: "sessionid", Scope: ScopeProject}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetPathValue("slug", "demo")
	req.SetPathValue("project_id", "project-1")
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-1"})
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
	if store.scope != ScopeProject || store.entityID != "" {
		t.Fatalf("scope=%q entity=%q", store.scope, store.entityID)
	}
}

func TestCyclePropertiesPatchKeepsLegacyCreatedStatus(t *testing.T) {
	store := &storeStub{patchResult: map[string]any{"cycle": "cycle-1"}}
	handler := Handler{Store: store, Scope: ScopeCycle}
	req := httptest.NewRequest(http.MethodPatch, "/", strings.NewReader(`{"display_filters":{"layout":"board"}}`))
	req.SetPathValue("slug", "demo")
	req.SetPathValue("project_id", "project-1")
	req.SetPathValue("cycle_id", "cycle-1")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("status=%d, want 201", res.Code)
	}
	if store.scope != ScopeCycle || store.entityID != "cycle-1" {
		t.Fatalf("scope=%q entity=%q", store.scope, store.entityID)
	}
	if store.patch["display_filters"] == nil {
		t.Fatal("display_filters patch was not forwarded")
	}
}

func TestPropertiesErrorsMatchAPIContract(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want int
	}{
		{"unauthorized", ErrUnauthorized, http.StatusUnauthorized},
		{"forbidden", ErrForbidden, http.StatusForbidden},
		{"not-found", ErrNotFound, http.StatusNotFound},
		{"invalid", ErrInvalidPayload, http.StatusBadRequest},
		{"storage", errors.New("down"), http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := httptest.NewRecorder()
			Handler{Store: &storeStub{err: tc.err}, Scope: ScopeProject}.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
			if res.Code != tc.want {
				t.Fatalf("status=%d, want %d", res.Code, tc.want)
			}
		})
	}
}
