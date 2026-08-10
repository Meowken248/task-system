package workspacecontext

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubStore struct {
	currentMemberResult map[string]any
	recentVisitsResult  []map[string]any
	sidebarResult       map[string]Preference
	userPropsResult     map[string]any
	err                 error
	recentEntity        string
	sidebarPatches      []PreferencePatch
	userPropsPatch      map[string]any
}

func (s *stubStore) CurrentMember(context.Context, string, string) (map[string]any, error) {
	return s.currentMemberResult, s.err
}

func (s *stubStore) RecentVisits(_ context.Context, _, _, entity string) ([]map[string]any, error) {
	s.recentEntity = entity
	return s.recentVisitsResult, s.err
}

func (s *stubStore) SidebarPreferences(context.Context, string, string) (map[string]Preference, error) {
	return s.sidebarResult, s.err
}

func (s *stubStore) PatchSidebarPreferences(_ context.Context, _, _ string, patches []PreferencePatch) error {
	s.sidebarPatches = patches
	return s.err
}

func (s *stubStore) UserProperties(context.Context, string, string) (map[string]any, error) {
	return s.userPropsResult, s.err
}

func (s *stubStore) PatchUserProperties(_ context.Context, _, _ string, patch map[string]any) (map[string]any, error) {
	s.userPropsPatch = patch
	return s.userPropsResult, s.err
}

func request(t *testing.T, handler http.Handler, method, target, body string, pathValues map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-key"})
	for key, value := range pathValues {
		req.SetPathValue(key, value)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	return response
}

func TestCurrentMember(t *testing.T) {
	store := &stubStore{currentMemberResult: map[string]any{"id": "member-id", "draft_issue_count": 2}}
	handler := Handler{Store: store, Mode: ModeCurrentMember}
	response := request(t, handler, http.MethodGet, "/api/workspaces/acme/workspace-members/me/", "", map[string]string{"slug": "acme"})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["id"] != "member-id" || payload["draft_issue_count"] != float64(2) {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("unexpected cache control: %q", response.Header().Get("Cache-Control"))
	}
}

func TestRecentVisitsPassesEntityFilter(t *testing.T) {
	store := &stubStore{recentVisitsResult: []map[string]any{}}
	handler := Handler{Store: store, Mode: ModeRecentVisits}
	response := request(t, handler, http.MethodGet, "/api/workspaces/acme/recent-visits/?entity_name=issue", "", map[string]string{"slug": "acme"})
	if response.Code != http.StatusOK || store.recentEntity != "issue" {
		t.Fatalf("status = %d, entity = %q", response.Code, store.recentEntity)
	}
}

func TestPatchSidebarPreferenceByKey(t *testing.T) {
	store := &stubStore{}
	handler := Handler{Store: store, Mode: ModeSidebarPreferences}
	response := request(t, handler, http.MethodPatch, "/api/workspaces/acme/sidebar-preferences/drafts/", `{"is_pinned":false}`, map[string]string{"slug": "acme", "preference_key": "drafts"})
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if len(store.sidebarPatches) != 1 || store.sidebarPatches[0].Key != "drafts" || store.sidebarPatches[0].IsPinned == nil || *store.sidebarPatches[0].IsPinned {
		t.Fatalf("unexpected patches: %#v", store.sidebarPatches)
	}
}

func TestPatchSidebarPreferencesRejectsInvalidJSON(t *testing.T) {
	handler := Handler{Store: &stubStore{}, Mode: ModeSidebarPreferences}
	response := request(t, handler, http.MethodPatch, "/api/workspaces/acme/sidebar-preferences/", `{`, map[string]string{"slug": "acme"})
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestPatchUserProperties(t *testing.T) {
	store := &stubStore{userPropsResult: map[string]any{"navigation_project_limit": 25}}
	handler := Handler{Store: store, Mode: ModeUserProperties}
	response := request(t, handler, http.MethodPatch, "/api/workspaces/acme/user-properties/", `{"navigation_project_limit":25}`, map[string]string{"slug": "acme"})
	if response.Code != http.StatusOK || store.userPropsPatch["navigation_project_limit"] != float64(25) {
		t.Fatalf("status = %d, patch = %#v", response.Code, store.userPropsPatch)
	}
}

func TestStoreErrorsMapToHTTP(t *testing.T) {
	tests := []struct {
		err  error
		want int
	}{
		{ErrUnauthorized, http.StatusUnauthorized},
		{ErrForbidden, http.StatusForbidden},
		{ErrNotFound, http.StatusNotFound},
		{ErrInvalidPayload, http.StatusBadRequest},
		{errors.New("database unavailable"), http.StatusServiceUnavailable},
	}
	for _, test := range tests {
		store := &stubStore{err: test.err}
		handler := Handler{Store: store, Mode: ModeCurrentMember}
		response := request(t, handler, http.MethodGet, "/api/workspaces/acme/workspace-members/me/", "", map[string]string{"slug": "acme"})
		if response.Code != test.want {
			t.Errorf("error %v: status = %d, want %d", test.err, response.Code, test.want)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	handler := Handler{Store: &stubStore{}, Mode: ModeCurrentMember}
	response := request(t, handler, http.MethodPatch, "/api/workspaces/acme/workspace-members/me/", `{}`, map[string]string{"slug": "acme"})
	if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != http.MethodGet {
		t.Fatalf("status = %d, allow = %q", response.Code, response.Header().Get("Allow"))
	}
}
