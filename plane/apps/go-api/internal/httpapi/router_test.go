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

func TestTimezoneRouteUsesGoHandler(t *testing.T) {
	timezones := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	req := httptest.NewRequest(http.MethodGet, "/api/timezones/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Timezones: timezones}).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
}

func TestUnsplashRouteUsesGoHandler(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) })
	req := httptest.NewRequest(http.MethodGet, "/api/unsplash/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Unsplash: handler}).ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", res.Code)
	}
}

func TestPageRoutesUseGoHandler(t *testing.T) {
	tests := []struct {
		method, path, action, version string
	}{
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/pages-summary/", "summary", ""},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/pages/", "", ""},
		{http.MethodPatch, "/api/workspaces/demo/projects/project-1/pages/page-1/", "", ""},
		{http.MethodPost, "/api/workspaces/demo/projects/project-1/favorite-pages/page-1/", "favorite", ""},
		{http.MethodPatch, "/api/workspaces/demo/projects/project-1/pages/page-1/description/", "description", ""},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/pages/page-1/versions/version-1/", "version", "version-1"},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			called := false
			pages := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				if got := r.PathValue("project_id"); got != "project-1" {
					t.Fatalf("project_id=%q", got)
				}
				if got := r.PathValue("page_action"); got != test.action {
					t.Fatalf("page_action=%q want=%q", got, test.action)
				}
				if got := r.PathValue("version_id"); got != test.version {
					t.Fatalf("version_id=%q want=%q", got, test.version)
				}
				w.WriteHeader(http.StatusAccepted)
			})
			res := httptest.NewRecorder()
			NewRouter(Dependencies{Pages: pages}).ServeHTTP(res, httptest.NewRequest(test.method, test.path, nil))
			if !called || res.Code != http.StatusAccepted {
				t.Fatalf("called=%t status=%d", called, res.Code)
			}
		})
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

func TestWorkspaceInvitationRoutesUseGoHandlers(t *testing.T) {
	workspaceInvites := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) })
	join := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusCreated) })
	userInvites := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	deps := Dependencies{
		WorkspaceInvitations:     workspaceInvites,
		WorkspaceInvitationJoin:  join,
		UserWorkspaceInvitations: userInvites,
	}
	for _, tc := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, "/api/workspaces/demo/invitations/", http.StatusAccepted},
		{http.MethodPost, "/api/workspaces/demo/invitations/", http.StatusAccepted},
		{http.MethodPatch, "/api/workspaces/demo/invitations/invite-1/", http.StatusAccepted},
		{http.MethodDelete, "/api/workspaces/demo/invitations/invite-1/", http.StatusAccepted},
		{http.MethodGet, "/api/workspaces/demo/invitations/invite-1/join/", http.StatusCreated},
		{http.MethodPost, "/api/workspaces/demo/invitations/invite-1/join/", http.StatusCreated},
		{http.MethodGet, "/api/users/me/workspaces/invitations/", http.StatusNoContent},
		{http.MethodPost, "/api/users/me/workspaces/invitations/", http.StatusNoContent},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		res := httptest.NewRecorder()
		NewRouter(deps).ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("method=%s path=%s status=%d, want %d", tc.method, tc.path, res.Code, tc.want)
		}
	}
}

func TestCurrentUserRouteUsesGoHandler(t *testing.T) {
	currentUser := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	for _, method := range []string{http.MethodGet, http.MethodPatch} {
		req := httptest.NewRequest(method, "/api/users/me/", nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{CurrentUser: currentUser}).ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("method=%s status = %d, want 200", method, res.Code)
		}
	}
}

func TestUserProfileAndSettingsRoutesUseGoHandlers(t *testing.T) {
	goHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/api/users/me/profile/"},
		{http.MethodPatch, "/api/users/me/profile/"},
		{http.MethodGet, "/api/users/me/settings/"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		res := httptest.NewRecorder()
		NewRouter(Dependencies{UserProfile: goHandler, UserSettings: goHandler}).ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("method=%s path=%s status=%d, want 200", tc.method, tc.path, res.Code)
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

func TestLabelCRUDUsesGoHandler(t *testing.T) {
	labels := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	for _, tc := range []struct {
		method string
		path   string
		want   int
	}{
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issue-labels/", http.StatusOK},
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issue-labels/label-1/", http.StatusOK},
		{http.MethodPost, "/api/workspaces/demo/projects/project-1/issue-labels/", http.StatusOK},
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
		{http.MethodGet, "/api/workspaces/demo/projects/project-1/issues/issue-1/?expand=assignees", http.StatusOK},
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

func TestProjectCycleAndModuleUserPropertyRoutesUseGoHandlers(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("project_id") != "project-1" {
			t.Fatalf("project_id=%q", r.PathValue("project_id"))
		}
		w.WriteHeader(http.StatusAccepted)
	})
	deps := Dependencies{
		ProjectUserProperties: handler,
		CycleUserProperties:   handler,
		ModuleUserProperties:  handler,
	}
	for _, path := range []string{
		"/api/workspaces/demo/projects/project-1/user-properties/",
		"/api/workspaces/demo/projects/project-1/cycles/cycle-1/user-properties/",
		"/api/workspaces/demo/projects/project-1/modules/module-1/user-properties/",
	} {
		for _, method := range []string{http.MethodGet, http.MethodPatch} {
			res := httptest.NewRecorder()
			NewRouter(deps).ServeHTTP(res, httptest.NewRequest(method, path, nil))
			if res.Code != http.StatusAccepted {
				t.Fatalf("method=%s path=%s status=%d, want 202", method, path, res.Code)
			}
		}
	}
}

func TestStickyRoutesUseGoHandler(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("slug") != "demo" {
			t.Fatalf("slug=%q", r.PathValue("slug"))
		}
		w.WriteHeader(http.StatusAccepted)
	})
	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/workspaces/demo/stickies/"},
		{http.MethodPost, "/api/workspaces/demo/stickies/"},
		{http.MethodGet, "/api/workspaces/demo/stickies/sticky-1"},
		{http.MethodPatch, "/api/workspaces/demo/stickies/sticky-1/"},
		{http.MethodDelete, "/api/workspaces/demo/stickies/sticky-1"},
	} {
		res := httptest.NewRecorder()
		NewRouter(Dependencies{Stickies: handler}).ServeHTTP(res, httptest.NewRequest(tc.method, tc.path, nil))
		if res.Code != http.StatusAccepted {
			t.Fatalf("method=%s path=%s status=%d, want 202", tc.method, tc.path, res.Code)
		}
	}
}
