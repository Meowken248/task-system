package sticky

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubStore struct {
	list       Page
	item       Item
	err        error
	deleteErr  error
	lastInput  WritePayload
	lastSticky string
}

func (s *stubStore) ListForSession(context.Context, string, string, ListOptions) (Page, error) {
	return s.list, s.err
}

func (s *stubStore) CreateForSession(_ context.Context, _, _ string, input WritePayload) (Item, error) {
	s.lastInput = input
	return s.item, s.err
}

func (s *stubStore) GetForSession(_ context.Context, _, _, stickyID string) (Item, error) {
	s.lastSticky = stickyID
	return s.item, s.err
}

func (s *stubStore) UpdateForSession(_ context.Context, _, _, stickyID string, input WritePayload) (Item, error) {
	s.lastSticky, s.lastInput = stickyID, input
	return s.item, s.err
}

func (s *stubStore) DeleteForSession(_ context.Context, _, _, stickyID string) error {
	s.lastSticky = stickyID
	return s.deleteErr
}

func stickyRequest(method, target, stickyID, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.SetPathValue("slug", "demo")
	req.SetPathValue("sticky_id", stickyID)
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session"})
	return req
}

func TestStickyList(t *testing.T) {
	store := &stubStore{list: Page{TotalCount: 1, Results: []Item{{ID: "sticky-1"}}}}
	res := httptest.NewRecorder()
	Handler{Store: store}.ServeHTTP(res, stickyRequest(http.MethodGet, "/api/workspaces/demo/stickies/", "", ""))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"total_count":1`) {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestStickyCreateAndUpdate(t *testing.T) {
	for _, tc := range []struct {
		method, stickyID string
		want             int
	}{
		{http.MethodPost, "", http.StatusCreated},
		{http.MethodPatch, "sticky-1", http.StatusOK},
	} {
		store := &stubStore{item: Item{ID: "sticky-1"}}
		res := httptest.NewRecorder()
		Handler{Store: store}.ServeHTTP(res, stickyRequest(tc.method, "/", tc.stickyID, `{"name":"note"}`))
		if res.Code != tc.want || store.lastInput.Name == nil || *store.lastInput.Name != "note" {
			t.Fatalf("method=%s status=%d input=%+v", tc.method, res.Code, store.lastInput)
		}
	}
}

func TestStickyDelete(t *testing.T) {
	store := &stubStore{}
	res := httptest.NewRecorder()
	Handler{Store: store}.ServeHTTP(res, stickyRequest(http.MethodDelete, "/", "sticky-1", ""))
	if res.Code != http.StatusNoContent || store.lastSticky != "sticky-1" {
		t.Fatalf("status=%d sticky=%q", res.Code, store.lastSticky)
	}
}

func TestStickyErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want int
	}{
		{ErrUnauthorized, http.StatusUnauthorized},
		{ErrForbidden, http.StatusForbidden},
		{ErrNotFound, http.StatusNotFound},
		{ErrInvalidHTML, http.StatusBadRequest},
		{errors.New("database down"), http.StatusServiceUnavailable},
	} {
		res := httptest.NewRecorder()
		Handler{Store: &stubStore{err: tc.err}}.ServeHTTP(res, stickyRequest(http.MethodGet, "/", "sticky-1", ""))
		if res.Code != tc.want {
			t.Fatalf("error=%v status=%d want=%d", tc.err, res.Code, tc.want)
		}
	}
}

func TestStickyInvalidCursor(t *testing.T) {
	res := httptest.NewRecorder()
	Handler{Store: &stubStore{}}.ServeHTTP(res, stickyRequest(http.MethodGet, "/?cursor=bad", "", ""))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
