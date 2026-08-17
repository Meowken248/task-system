package projectinvite

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	invitations []Invitation
	err         error
	joinedIDs   []string
}

func (s *storeStub) ListForSession(ctx context.Context, sessionKey, slug string) ([]Invitation, error) {
	return s.invitations, s.err
}

func (s *storeStub) BulkJoin(ctx context.Context, sessionKey, slug string, projectIDs []string) error {
	s.joinedIDs = projectIDs
	return s.err
}

func TestListInvitations(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/projects/invitations/", nil)
	req.SetPathValue("slug", "test-workspace")
	res := httptest.NewRecorder()

	stub := &storeStub{
		invitations: []Invitation{
			{ID: "inv-1", Email: "test@example.com", Accepted: false, Token: "tok-1"},
		},
	}
	Handler{Store: stub}.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}

	body := res.Body.String()
	if !strings.Contains(body, "inv-1") {
		t.Errorf("expected body to contain inv-1, got %s", body)
	}
}

func TestBulkJoinProjects(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/projects/invitations/", strings.NewReader(`{"project_ids": ["proj-1", "proj-2"]}`))
	req.SetPathValue("slug", "test-workspace")
	res := httptest.NewRecorder()

	stub := &storeStub{}
	Handler{Store: stub}.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("status=%d, want 201", res.Code)
	}

	if len(stub.joinedIDs) != 2 || stub.joinedIDs[0] != "proj-1" || stub.joinedIDs[1] != "proj-2" {
		t.Errorf("expected joinedIDs to be [proj-1, proj-2], got %v", stub.joinedIDs)
	}
}
