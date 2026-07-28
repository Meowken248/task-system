package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

type resetPasswordStoreStub struct {
	user        PasswordResetUser
	updatedID   string
	updatedHash string
}

func (s *resetPasswordStoreStub) ResetUserByID(context.Context, string) (PasswordResetUser, error) {
	return s.user, nil
}
func (s *resetPasswordStoreStub) SetResetPassword(_ context.Context, id, hash string) error {
	s.updatedID, s.updatedHash = id, hash
	return nil
}

func TestCheckDjangoPasswordResetToken(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	user := PasswordResetUser{ID: "550e8400-e29b-41d4-a716-446655440000", Email: "user@example.com", PasswordHash: "pbkdf2_sha256$600000$salt$hash"}
	token := makeDjangoPasswordResetToken(user, "secret", now)
	valid, expired := checkDjangoPasswordResetToken(user, "secret", token, now.Add(time.Hour), 72*time.Hour)
	if !valid || expired {
		t.Fatalf("valid=%v expired=%v", valid, expired)
	}
	valid, expired = checkDjangoPasswordResetToken(user, "secret", token, now.Add(73*time.Hour), 72*time.Hour)
	if valid || !expired {
		t.Fatalf("valid=%v expired=%v", valid, expired)
	}
}

func TestResetPasswordUpdatesAndRedirects(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	user := PasswordResetUser{ID: "user-id", Email: "user@example.com", PasswordHash: "pbkdf2_sha256$600000$salt$hash"}
	store := &resetPasswordStoreStub{user: user}
	h := ResetPasswordHandler{Store: store, AppBaseURL: "http://app.test", SecretKey: "secret", Now: func() time.Time { return now }}
	token := makeDjangoPasswordResetToken(user, "secret", now)
	form := url.Values{"password": {"Strong-password-2026!"}, "csrfmiddlewaretoken": {"abcdefghijklmnopqrstuvwxzyABCDEF"}}
	req := httptest.NewRequest(http.MethodPost, "/auth/reset-password/dXNlci1pZA/"+token+"/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: "csrftoken", Value: "abcdefghijklmnopqrstuvwxzyABCDEF"})
	req.SetPathValue("uidb64", "dXNlci1pZA")
	req.SetPathValue("token", token)
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusFound || res.Header().Get("Location") != "http://app.test/sign-in?success=True" {
		t.Fatalf("status=%d location=%s body=%s", res.Code, res.Header().Get("Location"), res.Body.String())
	}
	if store.updatedID != user.ID || !verifyDjangoPassword("Strong-password-2026!", store.updatedHash) {
		t.Fatalf("password was not updated: id=%s hash=%s", store.updatedID, store.updatedHash)
	}
}
