package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readinessStub struct{ err error }

func (s readinessStub) PingContext(context.Context) error { return s.err }

func TestLive(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Version: "test"}).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
	if got := res.Header().Get("X-Plane-Backend"); got != "go" {
		t.Fatalf("X-Plane-Backend = %q", got)
	}
}

func TestReadyFailsWhenDatabaseIsUnavailable(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Readiness: readinessStub{err: errors.New("down")}}).ServeHTTP(res, req)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", res.Code)
	}
}

func TestUnknownRouteUsesLegacyFallback(t *testing.T) {
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Legacy: legacy}).ServeHTTP(res, req)
	if res.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want 418", res.Code)
	}
}

func TestCSRFRouteUsesGoHandler(t *testing.T) {
	csrf := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	req := httptest.NewRequest(http.MethodGet, "/auth/get-csrf-token/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{CSRF: csrf, Legacy: legacy}).ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", res.Code)
	}
}

func TestTrackingRouteUsesGoHandler(t *testing.T) {
	tracking := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/demo/projects/00000000-0000-0000-0000-000000000001/blockchain-transactions/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Tracking: tracking, Legacy: legacy}).ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", res.Code)
	}
}

func TestUserWorkspacesRouteUsesGoHandler(t *testing.T) {
	workspaces := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/workspaces/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Workspaces: workspaces, Legacy: legacy}).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
}

func TestCurrentUserRouteUsesGoHandler(t *testing.T) {
	currentUser := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{CurrentUser: currentUser, Legacy: legacy}).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
}

func TestUserProfileAndSettingsRoutesUseGoHandlers(t *testing.T) {
	goHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	for _, path := range []string{"/api/users/me/profile/", "/api/users/me/settings/"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{UserProfile: goHandler, UserSettings: goHandler, Legacy: legacy}).ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("path=%s status=%d, want 200", path, res.Code)
		}
	}
}

func TestStateReadRoutesUseGoHandler(t *testing.T) {
	states := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("project_id") != "project-1" {
			t.Fatalf("project_id = %q", r.PathValue("project_id"))
		}
		w.WriteHeader(http.StatusOK)
	})
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	for _, path := range []string{
		"/api/workspaces/demo/projects/project-1/states/",
		"/api/workspaces/demo/projects/project-1/states/state-1/",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{States: states, Legacy: legacy}).ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("path=%s status=%d, want 200", path, res.Code)
		}
	}
}

func TestStateMutationStillUsesLegacy(t *testing.T) {
	states := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/demo/projects/project-1/states/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{States: states, Legacy: legacy}).ServeHTTP(res, req)
	if res.Code != http.StatusTeapot {
		t.Fatalf("status=%d, want legacy 418", res.Code)
	}
}

func TestUnportedProjectChildRouteUsesLegacyInsteadOfProjectList(t *testing.T) {
	projects := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/demo/projects/project-1/members/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{ProjectsLite: projects, Legacy: legacy}).ServeHTTP(res, req)
	if res.Code != http.StatusTeapot {
		t.Fatalf("status=%d, want legacy 418", res.Code)
	}
}

func TestProjectMemberListUsesGoHandlerButMutationUsesLegacy(t *testing.T) {
	members := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	path := "/api/workspaces/demo/projects/project-1/members/"
	for _, tc := range []struct {
		method string
		want   int
	}{{http.MethodGet, http.StatusOK}, {http.MethodPost, http.StatusTeapot}} {
		req := httptest.NewRequest(tc.method, path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{ProjectMembers: members, Legacy: legacy}).ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("method=%s status=%d, want %d", tc.method, res.Code, tc.want)
		}
	}
}

func TestLabelReadsUseGoHandlerButMutationUsesLegacy(t *testing.T) {
	labels := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	for _, tc := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issue-labels/", http.StatusOK},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issue-labels/label-1/", http.StatusOK},
		{http.MethodPost, "/api/workspaces/demo/projects/project-1/issue-labels/", http.StatusTeapot},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{Labels: labels, Legacy: legacy}).ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("method=%s path=%s status=%d, want %d", tc.method, tc.path, res.Code, tc.want)
		}
	}
}

func TestBasicIssueReadsUseGoAndComplexReadsUseLegacy(t *testing.T) {
	issues := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("project_id") != "project-1" {
			t.Fatalf("project_id=%q", r.PathValue("project_id"))
		}
		w.WriteHeader(http.StatusOK)
	})
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/", http.StatusOK},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/issue-1/", http.StatusOK},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/?group_by=state", http.StatusTeapot},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/issue-1/?expand=assignees", http.StatusTeapot},
		{http.MethodPost, "/api/workspaces/demo/projects/project-1/issues/", http.StatusTeapot},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{Issues: issues, Legacy: legacy}).ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("method=%s path=%s status=%d want=%d", tc.method, tc.path, res.Code, tc.want)
		}
	}
}
