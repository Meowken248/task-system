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

type signUpStoreStub struct {
	allowed bool
	exists  bool
	account SignUpAccount
}

func addValidCSRF(t *testing.T, request *http.Request) {
	t.Helper()
	secret := strings.Repeat("a", csrfSecretSize)
	token, err := maskSecret(secret)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(&http.Cookie{Name: csrfCookieName, Value: secret})
	if err := request.ParseForm(); err != nil {
		t.Fatal(err)
	}
	request.Form.Set("csrfmiddlewaretoken", token)
	request.PostForm = request.Form
}
func (s *signUpStoreStub) CanSignUp(context.Context, string) (bool, error) {
	return s.allowed, nil
}

func (s *signUpStoreStub) UserExists(context.Context, string) (bool, error) {
	return s.exists, nil
}

func (s *signUpStoreStub) CreateAccount(_ context.Context, account SignUpAccount) error {
	s.account = account
	return nil
}

func TestSignUpCreatesDjangoCompatibleAccountAndSession(t *testing.T) {
	store := &signUpStoreStub{allowed: true}
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	handler := SignUpHandler{
		Store: store, AppBaseURL: "http://localhost:3000", SecretKey: "test-secret",
		SessionAge: time.Hour, Now: func() time.Time { return now },
	}
	form := url.Values{"email": {"new@example.com"}, "password": {"Strong!Pass123"}}
	request := httptest.NewRequest(http.MethodPost, "/auth/sign-up/", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addValidCSRF(t, request)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusFound {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if location := response.Header().Get("Location"); location != "http://localhost:3000/onboarding" {
		t.Fatalf("location = %q", location)
	}
	if store.account.ID == "" || store.account.ProfileID == "" || store.account.PreferenceID == "" {
		t.Fatal("account identifiers were not generated")
	}
	if !verifyDjangoPassword("Strong!Pass123", store.account.PasswordHash) {
		t.Fatal("password is not Django compatible")
	}
	if store.account.Session.UserID != store.account.ID || store.account.Session.Data == "" {
		t.Fatal("session was not prepared for the new user")
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "session-id" || cookies[0].Value == "" {
		t.Fatalf("unexpected cookies: %#v", cookies)
	}
}

func TestSignUpRejectsWeakPassword(t *testing.T) {
	store := &signUpStoreStub{allowed: true}
	handler := SignUpHandler{Store: store, AppBaseURL: "http://localhost:3000", SecretKey: "secret"}
	form := url.Values{"email": {"new@example.com"}, "password": {"password"}}
	request := httptest.NewRequest(http.MethodPost, "/auth/sign-up/", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addValidCSRF(t, request)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusFound || !strings.Contains(response.Header().Get("Location"), "error_code=5021") {
		t.Fatalf("status = %d, location = %q", response.Code, response.Header().Get("Location"))
	}
	if store.account.ID != "" {
		t.Fatal("weak password unexpectedly created an account")
	}
}

func TestSignUpHonorsDisabledPolicy(t *testing.T) {
	store := &signUpStoreStub{allowed: false}
	handler := SignUpHandler{Store: store, AppBaseURL: "http://localhost:3000", SecretKey: "secret"}
	form := url.Values{"email": {"new@example.com"}, "password": {"Strong!Pass123"}}
	request := httptest.NewRequest(http.MethodPost, "/auth/sign-up/", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	addValidCSRF(t, request)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusFound || !strings.Contains(response.Header().Get("Location"), "error_code=5015") {
		t.Fatalf("status = %d, location = %q", response.Code, response.Header().Get("Location"))
	}
}

func TestRandomUUIDFormat(t *testing.T) {
	value, err := randomUUID()
	if err != nil {
		t.Fatal(err)
	}
	if len(value) != 36 || value[14] != '4' || (value[19] != '8' && value[19] != '9' && value[19] != 'a' && value[19] != 'b') {
		t.Fatalf("invalid UUID v4: %q", value)
	}
}
