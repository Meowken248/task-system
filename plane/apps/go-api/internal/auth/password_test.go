package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type passwordStoreStub struct {
	user        PasswordUser
	hash        string
	sessionData string
}

func (s *passwordStoreStub) UserForSession(context.Context, string) (PasswordUser, error) {
	return s.user, nil
}
func (s *passwordStoreStub) UpdatePassword(_ context.Context, _ string, _ string, hash, data string) error {
	s.hash = hash
	s.sessionData = data
	return nil
}
func passwordRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/auth/change-password/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "session"})
	secret := strings.Repeat("a", csrfSecretSize)
	token, err := maskSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: secret})
	req.Header.Set("X-CSRFToken", token)
	return req
}
func TestChangePasswordAcceptsCSRFFromHeader(t *testing.T) {
	hash, err := encodeDjangoPassword("Old!Password123")
	if err != nil {
		t.Fatal(err)
	}
	store := &passwordStoreStub{user: PasswordUser{ID: "user", Email: "user@example.com", PasswordHash: hash}}
	h := PasswordHandler{Store: store, SessionCookieName: "session-id", SecretKey: "secret"}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, passwordRequest(t, `{"old_password":"Old!Password123","new_password":"New!Password456"}`))
	if res.Code != http.StatusOK || !verifyDjangoPassword("New!Password456", store.hash) || store.sessionData == "" {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
func TestSetPasswordRejectsAlreadySet(t *testing.T) {
	store := &passwordStoreStub{user: PasswordUser{ID: "user", Email: "user@example.com", PasswordAutoset: false}}
	h := PasswordHandler{Store: store, SessionCookieName: "session-id", SecretKey: "secret", SetOnly: true}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, passwordRequest(t, `{"password":"New!Password456"}`))
	if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), "PASSWORD_ALREADY_SET") {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
