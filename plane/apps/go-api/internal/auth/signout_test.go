package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type revokerStub struct {
	key string
	ip  string
}

func (s *revokerStub) Revoke(_ context.Context, key, ip string) error {
	s.key, s.ip = key, ip
	return nil
}

func TestSignOutRevokesSessionAndRedirects(t *testing.T) {
	secret := strings.Repeat("a", csrfSecretSize)
	token, err := maskSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{"csrfmiddlewaretoken": {token}}
	req := httptest.NewRequest(http.MethodPost, "/auth/sign-out/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-Forwarded-For", "192.0.2.10")
	req.AddCookie(&http.Cookie{Name: csrfCookieName, Value: secret})
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "session-key"})
	res := httptest.NewRecorder()
	store := &revokerStub{}

	SignOutHandler{Store: store, SessionCookieName: "session-id", RedirectURL: "http://app.test"}.ServeHTTP(res, req)

	if res.Code != http.StatusFound || res.Header().Get("Location") != "http://app.test" {
		t.Fatalf("unexpected redirect: %d %q", res.Code, res.Header().Get("Location"))
	}
	if store.key != "session-key" || store.ip != "192.0.2.10" {
		t.Fatalf("unexpected revoke call: %#v", store)
	}
}

func TestSignOutRejectsMissingCSRF(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/auth/sign-out/", nil)
	res := httptest.NewRecorder()
	SignOutHandler{RedirectURL: "http://app.test"}.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", res.Code)
	}
}
