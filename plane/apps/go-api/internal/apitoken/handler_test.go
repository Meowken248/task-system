package apitoken

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	created CreateInput
	updated UpdateInput
	deleted string
	err     error
}

func (s *storeStub) List(context.Context, string) ([]Token, error) {
	return []Token{{ID: "token-1", Label: "CLI"}}, s.err
}
func (s *storeStub) Create(_ context.Context, _ string, input CreateInput) (Token, error) {
	s.created = input
	secret := "plane_api_secret"
	return Token{ID: "token-1", Label: "CLI", Token: &secret}, s.err
}
func (s *storeStub) Retrieve(context.Context, string, string, bool) (Token, error) {
	return Token{ID: "token-1", Label: "CLI"}, s.err
}
func (s *storeStub) Update(_ context.Context, _, _ string, input UpdateInput) (Token, error) {
	s.updated = input
	return Token{ID: "token-1", Label: "updated"}, s.err
}
func (s *storeStub) Delete(_ context.Context, _ string, id string) error {
	s.deleted = id
	return s.err
}

func TestCreateAPIToken(t *testing.T) {
	store := &storeStub{}
	handler := Handler{Store: store, SessionCookieName: "sessionid"}
	req := httptest.NewRequest(http.MethodPost, "/api/users/api-tokens/", strings.NewReader(`{"label":"CLI","description":"local"}`))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-key"})
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated || store.created.Label == nil || *store.created.Label != "CLI" {
		t.Fatalf("status=%d input=%+v body=%s", res.Code, store.created, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "plane_api_secret") {
		t.Fatalf("create response must include secret: %s", res.Body.String())
	}
}

func TestListAPITokensDoesNotExposeSecret(t *testing.T) {
	handler := Handler{Store: &storeStub{}}
	req := httptest.NewRequest(http.MethodGet, "/api/users/api-tokens/", nil)
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-key"})
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK || strings.Contains(res.Body.String(), `"token"`) {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestDeleteAPIToken(t *testing.T) {
	store := &storeStub{}
	handler := Handler{Store: store}
	req := httptest.NewRequest(http.MethodDelete, "/api/users/api-tokens/token-1/", nil)
	req.SetPathValue("token_id", "token-1")
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-key"})
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent || store.deleted != "token-1" {
		t.Fatalf("status=%d deleted=%q", res.Code, store.deleted)
	}
}

func TestAPITokenErrors(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want int
	}{{ErrUnauthorized, 401}, {ErrNotFound, 404}, {errors.New("database"), 503}} {
		res := httptest.NewRecorder()
		writeStoreError(res, tc.err)
		if res.Code != tc.want {
			t.Fatalf("error=%v status=%d want=%d", tc.err, res.Code, tc.want)
		}
	}
}
