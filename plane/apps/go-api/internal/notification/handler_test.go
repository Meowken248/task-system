package notification

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type storeStub struct {
	items       []Notification
	total       int
	unread      int
	mentions    int
	lastSession string
	lastSlug    string
	lastID      string
}

func (s *storeStub) capture(session, slug string) {
	s.lastSession = session
	s.lastSlug = slug
}

func (s *storeStub) ListForSession(_ context.Context, session, slug string, _ ListOptions) ([]Notification, int, error) {
	s.capture(session, slug)
	return s.items, s.total, nil
}
func (s *storeStub) UnreadCounts(_ context.Context, session, slug string) (int, int, error) {
	s.capture(session, slug)
	return s.unread, s.mentions, nil
}
func (s *storeStub) UpdateForSession(_ context.Context, session, slug, id string, _ *time.Time) (Notification, error) {
	s.capture(session, slug)
	s.lastID = id
	return Notification{ID: id}, nil
}
func (s *storeStub) SetReadForSession(_ context.Context, session, slug, id string, _ bool) (Notification, error) {
	s.capture(session, slug)
	s.lastID = id
	return Notification{ID: id}, nil
}
func (s *storeStub) SetArchivedForSession(_ context.Context, session, slug, id string, _ bool) (Notification, error) {
	s.capture(session, slug)
	s.lastID = id
	return Notification{ID: id}, nil
}
func (s *storeStub) MarkAllReadForSession(_ context.Context, session, slug string, _ ListOptions) (int64, error) {
	s.capture(session, slug)
	return 2, nil
}

func notificationMux(store Store) http.Handler {
	mux := http.NewServeMux()
	handler := Handler{Store: store, SessionCookieName: "sessionid"}
	mux.Handle("/api/workspaces/{slug}/users/notifications", handler)
	mux.Handle("/api/workspaces/{slug}/users/notifications/{tail...}", handler)
	return mux
}

func request(t *testing.T, handler http.Handler, method, path, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if authenticated {
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-key"})
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

func TestRequiresSessionCookie(t *testing.T) {
	res := request(t, notificationMux(&storeStub{}), http.MethodGet, "/api/workspaces/demo/users/notifications", "", false)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=%d", res.Code, http.StatusUnauthorized)
	}
}

func TestUnreadCountsAndPaginationShape(t *testing.T) {
	store := &storeStub{unread: 4, mentions: 2, total: 7, items: []Notification{{ID: "notification-1"}}}
	handler := notificationMux(store)
	res := request(t, handler, http.MethodGet, "/api/workspaces/demo/users/notifications/unread/", "", true)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"total_unread_notifications_count":4`) {
		t.Fatalf("unexpected unread response: status=%d body=%s", res.Code, res.Body.String())
	}
	res = request(t, handler, http.MethodGet, "/api/workspaces/demo/users/notifications?per_page=30", "", true)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"total_count":7`) || !strings.Contains(res.Body.String(), `"results"`) {
		t.Fatalf("unexpected list response: status=%d body=%s", res.Code, res.Body.String())
	}
	if store.lastSession != "session-key" || store.lastSlug != "demo" {
		t.Fatalf("identity not forwarded: session=%q slug=%q", store.lastSession, store.lastSlug)
	}
}

func TestNotificationMutations(t *testing.T) {
	store := &storeStub{}
	handler := notificationMux(store)
	for _, test := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/workspaces/demo/users/notifications/n-1/read/"},
		{http.MethodDelete, "/api/workspaces/demo/users/notifications/n-1/archive/"},
		{http.MethodPatch, "/api/workspaces/demo/users/notifications/n-1/"},
	} {
		body := ""
		if test.method == http.MethodPatch {
			body = `{}`
		}
		res := request(t, handler, test.method, test.path, body, true)
		if res.Code != http.StatusOK {
			t.Fatalf("%s %s status=%d body=%s", test.method, test.path, res.Code, res.Body.String())
		}
		if store.lastID != "n-1" {
			t.Fatalf("notification id=%q", store.lastID)
		}
	}
}
