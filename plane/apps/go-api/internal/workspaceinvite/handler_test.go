package workspaceinvite

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	created        []InviteInput
	joinedToken    string
	joinedAccepted bool
}

func (s *storeStub) List(context.Context, string, string) ([]map[string]any, error) {
	return []map[string]any{{"id": "invite-1"}}, nil
}
func (s *storeStub) Create(_ context.Context, _, _ string, inputs []InviteInput) error {
	s.created = inputs
	return nil
}
func (s *storeStub) Retrieve(context.Context, string, string, string) (map[string]any, error) {
	return map[string]any{"id": "invite-1"}, nil
}
func (s *storeStub) Update(context.Context, string, string, string, int16) (map[string]any, error) {
	return map[string]any{"id": "invite-1", "role": 15}, nil
}
func (s *storeStub) Delete(context.Context, string, string, string) error { return nil }
func (s *storeStub) PublicRetrieve(context.Context, string, string) (map[string]any, error) {
	return map[string]any{"id": "invite-1"}, nil
}
func (s *storeStub) Join(_ context.Context, _, _, token string, accepted bool) (string, error) {
	s.joinedToken, s.joinedAccepted = token, accepted
	return "Workspace Invitation Accepted", nil
}
func (s *storeStub) ListForUser(context.Context, string) ([]map[string]any, error) {
	return []map[string]any{{"id": "invite-1"}}, nil
}
func (s *storeStub) JoinForUser(context.Context, string, []string) error { return nil }

func TestCreateWorkspaceInvitations(t *testing.T) {
	store := &storeStub{}
	handler := Handler{Store: store, SessionCookieName: "sessionid"}
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/demo/invitations/",
		strings.NewReader(`{"emails":[{"email":"member@example.com","role":15}]}`))
	req.SetPathValue("slug", "demo")
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-key"})
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	if len(store.created) != 1 || store.created[0].Email != "member@example.com" || store.created[0].Role != 15 {
		t.Fatalf("created=%+v", store.created)
	}
}

func TestJoinWorkspaceInvitationIsPublic(t *testing.T) {
	store := &storeStub{}
	handler := Handler{Store: store, Mode: ModeJoin}
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/demo/invitations/invite-1/join/",
		strings.NewReader(`{"token":"signed-token","accepted":true}`))
	req.SetPathValue("slug", "demo")
	req.SetPathValue("invitation_id", "invite-1")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	if store.joinedToken != "signed-token" || !store.joinedAccepted {
		t.Fatalf("token=%q accepted=%v", store.joinedToken, store.joinedAccepted)
	}
}

func TestInvitationStoreErrorsPreserveHTTPStatus(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want int
	}{
		{ErrUnauthorized, http.StatusUnauthorized},
		{ErrForbidden, http.StatusForbidden},
		{ErrNotFound, http.StatusNotFound},
		{ErrInvalidRole, http.StatusBadRequest},
	} {
		res := httptest.NewRecorder()
		writeStoreError(res, tc.err)
		if res.Code != tc.want {
			t.Fatalf("error=%v status=%d want=%d", tc.err, res.Code, tc.want)
		}
	}
}
