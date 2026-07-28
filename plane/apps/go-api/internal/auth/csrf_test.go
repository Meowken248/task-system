package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCSRFHandlerReturnsDjangoCompatibleTokenAndCookie(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/get-csrf-token/", nil)
	res := httptest.NewRecorder()
	CSRFHandler{}.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body["csrf_token"]) != 64 {
		t.Fatalf("token length = %d, want 64", len(body["csrf_token"]))
	}
	cookies := res.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != csrfCookieName || len(cookies[0].Value) != csrfSecretSize {
		t.Fatalf("unexpected cookies: %#v", cookies)
	}
	if !cookies[0].HttpOnly || cookies[0].Secure {
		t.Fatalf("unexpected cookie flags: %#v", cookies[0])
	}
}

func TestCSRFHandlerUsesSecureCookieBehindHTTPSProxy(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/auth/get-csrf-token/", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	res := httptest.NewRecorder()
	CSRFHandler{CookieDomain: "example.test"}.ServeHTTP(res, req)
	cookie := res.Result().Cookies()[0]
	if !cookie.Secure || cookie.Domain != "example.test" {
		t.Fatalf("unexpected cookie: %#v", cookie)
	}
}

func TestMaskSecretRejectsInvalidSecret(t *testing.T) {
	if _, err := maskSecret(strings.Repeat("!", csrfSecretSize)); err == nil {
		t.Fatal("expected invalid character error")
	}
}
