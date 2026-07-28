package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type emailCheckStoreStub struct {
	ready  bool
	result EmailCheckResult
}

func (s emailCheckStoreStub) InstanceReady(context.Context) (bool, error) { return s.ready, nil }
func (s emailCheckStoreStub) CheckEmail(context.Context, string) (EmailCheckResult, error) {
	return s.result, nil
}

func TestEmailCheckCredentialUser(t *testing.T) {
	h := EmailCheckHandler{Store: emailCheckStoreStub{ready: true, result: EmailCheckResult{Exists: true, SMTPConfigured: true, MagicLoginEnabled: true}}}
	req := httptest.NewRequest(http.MethodPost, "/auth/email-check/", strings.NewReader(`{"email":"user@example.com"}`))
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"status":"CREDENTIAL"`) || !strings.Contains(res.Body.String(), `"existing":true`) {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
func TestEmailCheckMagicForAutosetUser(t *testing.T) {
	h := EmailCheckHandler{Store: emailCheckStoreStub{ready: true, result: EmailCheckResult{Exists: true, PasswordAutoset: true, SMTPConfigured: true, MagicLoginEnabled: true}}}
	req := httptest.NewRequest(http.MethodPost, "/auth/email-check/", strings.NewReader(`{"email":"user@example.com"}`))
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"status":"MAGIC_CODE"`) {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
func TestEmailCheckRejectsUnconfiguredInstance(t *testing.T) {
	h := EmailCheckHandler{Store: emailCheckStoreStub{}}
	req := httptest.NewRequest(http.MethodPost, "/auth/email-check/", strings.NewReader(`{"email":"user@example.com"}`))
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), "INSTANCE_NOT_CONFIGURED") {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}
