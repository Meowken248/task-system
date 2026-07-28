package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type forgotStoreStub struct {
	user  PasswordResetUser
	ready bool
}

func (s forgotStoreStub) InstanceReady(context.Context) (bool, error) { return s.ready, nil }
func (s forgotStoreStub) ResetUser(context.Context, string) (PasswordResetUser, error) {
	return s.user, nil
}

type resetSenderStub struct{ link string }

func (s *resetSenderStub) SendPasswordReset(_ context.Context, _ PasswordResetUser, link string) error {
	s.link = link
	return nil
}
func TestPasswordResetTokenStable(t *testing.T) {
	u := PasswordResetUser{ID: "550e8400-e29b-41d4-a716-446655440000", Email: "user@example.com", PasswordHash: "pbkdf2_sha256$600000$salt$hash"}
	token := makeDjangoPasswordResetToken(u, "secret", time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))
	if token != "dcfdc0-de1ab12a269f9a0a673bcd07912139f9" {
		t.Fatalf("token=%s", token)
	}
}
func TestForgotPasswordSendsLink(t *testing.T) {
	sender := &resetSenderStub{}
	h := ForgotPasswordHandler{Store: forgotStoreStub{ready: true, user: PasswordResetUser{ID: "id", Email: "user@example.com", PasswordHash: "hash"}}, Sender: sender, AppBaseURL: "http://app.test", SecretKey: "secret", Now: func() time.Time { return time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC) }}
	req := httptest.NewRequest(http.MethodPost, "/auth/forgot-password/", strings.NewReader(`{"email":"user@example.com"}`))
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(sender.link, "uidb64=aWQ") || !strings.Contains(sender.link, "token=") {
		t.Fatalf("status=%d link=%s body=%s", res.Code, sender.link, res.Body.String())
	}
}
