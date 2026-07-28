package project

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readerStub struct {
	list      []map[string]any
	project   map[string]any
	err       error
	session   string
	slug      string
	projectID string
	detailed  bool
}

func (s *readerStub) ListForSession(_ context.Context, session, slug string, detailed bool, _ []string) ([]map[string]any, error) {
	s.session, s.slug, s.detailed = session, slug, detailed
	return s.list, s.err
}

func (s *readerStub) GetForSession(_ context.Context, session, slug, projectID string) (map[string]any, error) {
	s.session, s.slug, s.projectID = session, slug, projectID
	return s.project, s.err
}

func TestListHandlerReturnsProjects(t *testing.T) {
	store := &readerStub{list: []map[string]any{{"id": "project-id"}}}
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/demo/projects/details/", nil)
	req.SetPathValue("slug", "demo")
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "valid-session"})
	res := httptest.NewRecorder()
	Handler{Store: store, SessionCookieName: "session-id", Detailed: true}.ServeHTTP(res, req)
	if res.Code != http.StatusOK || store.session != "valid-session" || store.slug != "demo" || !store.detailed {
		t.Fatalf("status=%d session=%q slug=%q detailed=%v", res.Code, store.session, store.slug, store.detailed)
	}
}

func TestDetailHandlerReturnsProject(t *testing.T) {
	store := &readerStub{project: map[string]any{"id": "project-id"}}
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/demo/projects/project-id/", nil)
	req.SetPathValue("slug", "demo")
	req.SetPathValue("project_id", "project-id")
	res := httptest.NewRecorder()
	Handler{Store: store, Single: true}.ServeHTTP(res, req)
	if res.Code != http.StatusOK || store.projectID != "project-id" {
		t.Fatalf("status=%d project=%q", res.Code, store.projectID)
	}
}

func TestHandlerMapsAccessErrors(t *testing.T) {
	for name, testCase := range map[string]struct {
		err  error
		want int
	}{
		"unauthorized": {ErrUnauthorized, http.StatusUnauthorized},
		"forbidden":    {ErrForbidden, http.StatusForbidden},
		"not-found":    {ErrNotFound, http.StatusNotFound},
	} {
		t.Run(name, func(t *testing.T) {
			res := httptest.NewRecorder()
			Handler{Store: &readerStub{err: testCase.err}}.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
			if res.Code != testCase.want {
				t.Fatalf("status=%d want=%d", res.Code, testCase.want)
			}
		})
	}
}

func TestListHandlerUsesLegacyForPagination(t *testing.T) {
	called := false
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	})
	res := httptest.NewRecorder()
	Handler{Store: &readerStub{}, Legacy: legacy}.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/?cursor=next", nil))
	if !called || res.Code != http.StatusAccepted {
		t.Fatalf("legacy called=%v status=%d", called, res.Code)
	}
}
