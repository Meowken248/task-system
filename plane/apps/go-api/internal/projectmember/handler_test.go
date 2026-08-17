package projectmember

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type readerStub struct {
	items []Membership
	item  Membership
	err   error
}

func (s readerStub) ListForSession(context.Context, string, string, string) ([]Membership, error) {
	return s.items, s.err
}

func (s readerStub) GetForSession(context.Context, string, string, string) (Membership, error) {
	return s.item, s.err
}

func (s readerStub) BulkCreate(context.Context, string, string, string, []map[string]any) error {
	return s.err
}

func (s readerStub) UpdateRole(context.Context, string, string, string, string, int16) (Membership, error) {
	return s.item, s.err
}

func (s readerStub) Remove(context.Context, string, string, string, string) error {
	return s.err
}

func (s readerStub) Leave(context.Context, string, string, string) error {
	return s.err
}

func (s readerStub) UpdateViewProps(context.Context, string, string, string, map[string]any) error {
	return s.err
}

func (s readerStub) UserProjectRoles(ctx context.Context, sessionKey, slug string) (map[string]int16, error) {
	return map[string]int16{"project-1": 20}, s.err
}

func TestUserProjectRoles(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/project-roles/", nil)
	res := httptest.NewRecorder()
	UserProjectRolesHandler{Store: readerStub{}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestList(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/members/", nil)
	res := httptest.NewRecorder()
	Handler{Store: readerStub{items: []Membership{{ID: "member-1", Member: "user-1", Role: 20, OriginalRole: 20}}}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestUnauthorized(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/members/", nil)
	res := httptest.NewRecorder()
	Handler{Store: readerStub{err: ErrUnauthorized}}.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", res.Code)
	}
}
func TestCurrentMember(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/project-members/me/", nil)
	res := httptest.NewRecorder()
	Handler{
		Store:   readerStub{item: Membership{ID: "member-1", Member: "user-1", Role: 20, OriginalRole: 20}},
		Current: true,
	}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestPostBulkCreate(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/members/", strings.NewReader(`{"members":[{"member_id":"user-1","role":20}]}`))
	res := httptest.NewRecorder()
	Handler{Store: readerStub{items: []Membership{{ID: "member-1"}}}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestPatchRole(t *testing.T) {
	req := httptest.NewRequest(http.MethodPatch, "/members/member-1/", strings.NewReader(`{"role":15}`))
	req.SetPathValue("member_id", "member-1")
	res := httptest.NewRecorder()
	Handler{Store: readerStub{item: Membership{ID: "member-1", Role: 15}}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestDeleteRemove(t *testing.T) {
	req := httptest.NewRequest(http.MethodDelete, "/members/member-1/", nil)
	req.SetPathValue("member_id", "member-1")
	res := httptest.NewRecorder()
	Handler{Store: readerStub{}}.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status=%d, want 204", res.Code)
	}
}

func TestLeave(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/members/leave/", nil)
	res := httptest.NewRecorder()
	Handler{Store: readerStub{}, Leave: true}.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status=%d, want 204", res.Code)
	}
}

type workspaceReaderStub struct {
	items map[string][]Membership
	err   error
}

func (s workspaceReaderStub) WorkspaceListForSession(context.Context, string, string) (map[string][]Membership, error) {
	return s.items, s.err
}

func TestWorkspaceList(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/project-members/", nil)
	res := httptest.NewRecorder()
	WorkspaceProjectMembersHandler{Store: workspaceReaderStub{
		items: map[string][]Membership{"project-1": {{ID: "member-1", Member: "user-1", Role: 20, OriginalRole: 20}}},
	}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestWorkspaceUnauthorized(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/project-members/", nil)
	res := httptest.NewRecorder()
	WorkspaceProjectMembersHandler{Store: workspaceReaderStub{err: ErrUnauthorized}}.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", res.Code)
	}
}

func TestProjectUserViews(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/project-views/", strings.NewReader(`{"view_props":{"list":true}}`))
	res := httptest.NewRecorder()
	ProjectUserViewsHandler{Store: readerStub{}}.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("status=%d, want 204", res.Code)
	}
}
