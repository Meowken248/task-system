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

func TestUnknownRouteReturnsNotFound(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{}).ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.Code)
	}
}

func TestCSRFRouteUsesGoHandler(t *testing.T) {
	csrf := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	req := httptest.NewRequest(http.MethodGet, "/auth/get-csrf-token/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{CSRF: csrf}).ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", res.Code)
	}
}

func TestTrackingRouteUsesGoHandler(t *testing.T) {
	tracking := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) })
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/demo/projects/00000000-0000-0000-0000-000000000001/blockchain-transactions/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Tracking: tracking}).ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", res.Code)
	}
}

func TestUserWorkspacesRouteUsesGoHandler(t *testing.T) {
	workspaces := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/workspaces/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Workspaces: workspaces}).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
}

func TestCurrentUserRouteUsesGoHandler(t *testing.T) {
	currentUser := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{CurrentUser: currentUser}).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
}

func TestUserProfileAndSettingsRoutesUseGoHandlers(t *testing.T) {
	goHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	for _, path := range []string{"/api/users/me/profile/", "/api/users/me/settings/"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{UserProfile: goHandler, UserSettings: goHandler}).ServeHTTP(res, req)
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
	for _, path := range []string{
		"/api/workspaces/demo/projects/project-1/states/",
		"/api/workspaces/demo/projects/project-1/states/state-1/",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{States: states}).ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("path=%s status=%d, want 200", path, res.Code)
		}
	}
}

func TestUnportedStateMutationReturnsNotFound(t *testing.T) {
	states := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/demo/projects/project-1/states/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{States: states}).ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status=%d, want 404", res.Code)
	}
}

func TestUnportedProjectChildRouteReturnsNotFound(t *testing.T) {
	projects := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/demo/projects/project-1/members/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{ProjectsLite: projects}).ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status=%d, want 404", res.Code)
	}
}

func TestProjectMemberListUsesGoHandlerButMutationUsesLegacy(t *testing.T) {
	members := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	path := "/api/workspaces/demo/projects/project-1/members/"
	for _, tc := range []struct {
		method string
		want   int
	}{{http.MethodGet, http.StatusOK}, {http.MethodPost, http.StatusNotFound}} {
		req := httptest.NewRequest(tc.method, path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{ProjectMembers: members}).ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("method=%s status=%d, want %d", tc.method, res.Code, tc.want)
		}
	}
}

func TestLabelReadsUseGoHandlerButMutationUsesLegacy(t *testing.T) {
	labels := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	for _, tc := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issue-labels/", http.StatusOK},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issue-labels/label-1/", http.StatusOK},
		{http.MethodPost, "/api/workspaces/demo/projects/project-1/issue-labels/", http.StatusNotFound},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{Labels: labels}).ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("method=%s path=%s status=%d, want %d", tc.method, tc.path, res.Code, tc.want)
		}
	}
}

func TestBasicIssueCRUDUsesGoAndComplexReadsUseLegacy(t *testing.T) {
	issues := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("project_id") != "project-1" {
			t.Fatalf("project_id=%q", r.PathValue("project_id"))
		}
		w.WriteHeader(http.StatusOK)
	})
	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/", http.StatusOK},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/issue-1/", http.StatusOK},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/?group_by=state", http.StatusOK},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/issue-1/?expand=assignees", http.StatusNotFound},
		{http.MethodPost, "/api/workspaces/demo/projects/project-1/issues/", http.StatusOK},
		{http.MethodPatch, "/api/workspaces/demo/projects/project-1/issues/issue-1/", http.StatusOK},
		{http.MethodDelete, "/api/workspaces/demo/projects/project-1/issues/issue-1/", http.StatusOK},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{Issues: issues}).ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("method=%s path=%s status=%d want=%d", tc.method, tc.path, res.Code, tc.want)
		}
	}
}

func TestPasswordRecoveryRoutesUseGoHandlers(t *testing.T) {
	forgot := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) })
	reset := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("uidb64") != "dXNlcg" || r.PathValue("token") != "token-value" {
			t.Fatalf("uid=%q token=%q", r.PathValue("uidb64"), r.PathValue("token"))
		}
		w.WriteHeader(http.StatusNoContent)
	})
	for _, tc := range []struct {
		path string
		want int
	}{
		{"/auth/forgot-password/", http.StatusAccepted},
		{"/auth/reset-password/dXNlcg/token-value/", http.StatusNoContent},
	} {
		req := httptest.NewRequest(http.MethodPost, tc.path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{ForgotPassword: forgot, ResetPassword: reset}).ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("path=%s status=%d want=%d", tc.path, res.Code, tc.want)
		}
	}
}

func TestNotificationRoutesUseGoHandler(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("slug") != "demo" {
			t.Fatalf("slug=%q", r.PathValue("slug"))
		}
		w.WriteHeader(http.StatusOK)
	})
	for _, path := range []string{
		"/api/workspaces/demo/users/notifications",
		"/api/workspaces/demo/users/notifications/unread/",
		"/api/workspaces/demo/users/notifications/notification-1/read/",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{Notification: handler}).ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("path=%s status=%d want=200", path, res.Code)
		}
	}
}
