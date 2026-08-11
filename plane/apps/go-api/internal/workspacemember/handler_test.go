package workspacemember

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeStore struct {
	list        []map[string]any
	result      map[string]any
	err         error
	updatedRole int16
}

func (f *fakeStore) List(context.Context, string, string) ([]map[string]any, error) {
	return f.list, f.err
}
func (f *fakeStore) Retrieve(context.Context, string, string, string) (map[string]any, error) {
	return f.result, f.err
}
func (f *fakeStore) UpdateRole(_ context.Context, _, _, _ string, role int16) (map[string]any, error) {
	f.updatedRole = role
	return f.result, f.err
}
func (f *fakeStore) Remove(context.Context, string, string, string) error { return f.err }
func (f *fakeStore) Leave(context.Context, string, string) error          { return f.err }
func (f *fakeStore) UpdateViewProps(context.Context, string, string, map[string]any) error { return f.err }

func request(method, path, body string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.AddCookie(&http.Cookie{Name: "sessionid", Value: "session"})
	r.SetPathValue("slug", "acme")
	return r
}

func TestListMembers(t *testing.T) {
	store := &fakeStore{list: []map[string]any{{"id": "member-1", "role": int16(20)}}}
	w := httptest.NewRecorder()
	Handler{Store: store}.ServeHTTP(w, request(http.MethodGet, "/api/workspaces/acme/members/", ""))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "member-1") {
		t.Fatalf("response=%d %s", w.Code, w.Body.String())
	}
}

func TestPatchRole(t *testing.T) {
	store := &fakeStore{result: map[string]any{"id": "member-1", "role": 15}}
	r := request(http.MethodPatch, "/api/workspaces/acme/members/member-1/", `{"role":15}`)
	r.SetPathValue("member_id", "member-1")
	w := httptest.NewRecorder()
	Handler{Store: store}.ServeHTTP(w, r)
	if w.Code != http.StatusOK || store.updatedRole != 15 {
		t.Fatalf("response=%d role=%d", w.Code, store.updatedRole)
	}
}

func TestPatchRejectsInvalidPayload(t *testing.T) {
	res := httptest.NewRecorder()
	Handler{Store: &fakeStore{err: ErrCannotRemoveSelf}, Leave: true}.ServeHTTP(res, request(http.MethodPatch, "/", `{}`))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d", res.Code)
	}
}

func TestViews(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/views/", strings.NewReader(`{"view_props":{"a":1}}`))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session"})
	res := httptest.NewRecorder()
	ViewsHandler{Store: &fakeStore{}}.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status=%d", res.Code)
	}
}

func TestDeleteMapsBusinessError(t *testing.T) {
	r := request(http.MethodDelete, "/", "")
	r.SetPathValue("member_id", "member-1")
	w := httptest.NewRecorder()
	Handler{Store: &fakeStore{err: ErrOnlyProjectAdmin}}.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "only admin") {
		t.Fatalf("response=%d %s", w.Code, w.Body.String())
	}
}

func TestLeave(t *testing.T) {
	w := httptest.NewRecorder()
	Handler{Store: &fakeStore{}, Leave: true}.ServeHTTP(w, request(http.MethodPost, "/", ""))
	if w.Code != http.StatusNoContent {
		t.Fatalf("status=%d", w.Code)
	}
}

func TestErrorMappings(t *testing.T) {
	tests := []struct {
		err    error
		status int
	}{
		{ErrUnauthorized, 401}, {ErrForbidden, 403}, {ErrNotFound, 404}, {ErrCannotUpdateSelf, 400},
		{ErrCannotRemoveSelf, 400}, {ErrHigherRole, 400}, {ErrOnlyWorkspaceAdmin, 400},
		{ErrLeavingOnlyProjectAdmin, 400}, {ErrInvalidRole, 400}, {errors.New("db"), 503},
	}
	for _, tc := range tests {
		w := httptest.NewRecorder()
		Handler{Store: &fakeStore{err: tc.err}}.ServeHTTP(w, request(http.MethodGet, "/", ""))
		if w.Code != tc.status {
			t.Fatalf("error=%v status=%d want=%d", tc.err, w.Code, tc.status)
		}
	}
}
