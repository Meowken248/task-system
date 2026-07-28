package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/pbkdf2"
)

type signInStoreStub struct {
	user    LoginUser
	findErr error
	session LoginSession
	path    string
}

func (s *signInStoreStub) FindLoginUser(context.Context, string) (LoginUser, error) {
	return s.user, s.findErr
}
func (s *signInStoreStub) CreateLoginSession(_ context.Context, session LoginSession) error {
	s.session = session
	return nil
}
func (s *signInStoreStub) RedirectPath(context.Context, string, string) (string, error) {
	return s.path, nil
}

func TestSignInCreatesDjangoCompatibleSession(t *testing.T) {
	store := &signInStoreStub{user: LoginUser{ID: "8ab3ef80-b72d-45bf-9a80-8f6ea6ddcb01", Email: "user@example.com", PasswordHash: testPassword("secret123"), IsActive: true}, path: "/workspace"}
	handler := SignInHandler{Store: store, SessionCookieName: "session-id", AppBaseURL: "http://localhost:3000", SecretKey: "test-secret", SessionAge: time.Hour, Now: func() time.Time { return time.Unix(1_700_000_000, 0) }}
	form := url.Values{"email": {"USER@example.com"}, "password": {"secret123"}, "csrfmiddlewaretoken": {"abcdefghijklmnopqrstuvwxyzABCDEF"}}
	req := httptest.NewRequest(http.MethodPost, "/auth/sign-in/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: "csrftoken", Value: "abcdefghijklmnopqrstuvwxyzABCDEF"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusFound {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Location") != "http://localhost:3000/workspace" {
		t.Fatalf("location=%q", response.Header().Get("Location"))
	}
	if store.session.UserID != store.user.ID || store.session.Data == "" {
		t.Fatalf("session not persisted: %#v", store.session)
	}
	parts := strings.Split(store.session.Data, ":")
	if len(parts) != 3 {
		t.Fatalf("invalid Django session format: %q", store.session.Data)
	}
	if _, err := parseDjangoSessionTimestamp(parts[1]); err != nil {
		t.Fatal(err)
	}
	if parts[2] != djangoSignature(djangoSessionSalt+"signer", parts[0]+":"+parts[1], "test-secret") {
		t.Fatal("invalid session signature")
	}
	if len(response.Result().Cookies()) == 0 || response.Result().Cookies()[0].Value != store.session.Key {
		t.Fatal("session cookie missing")
	}
}

func TestSignInRejectsInvalidPassword(t *testing.T) {
	store := &signInStoreStub{user: LoginUser{ID: "1", Email: "user@example.com", PasswordHash: testPassword("correct"), IsActive: true}}
	handler := SignInHandler{Store: store, AppBaseURL: "http://localhost:3000", SecretKey: "secret"}
	form := url.Values{"email": {"user@example.com"}, "password": {"wrong"}, "csrfmiddlewaretoken": {"abcdefghijklmnopqrstuvwxyzABCDEF"}}
	req := httptest.NewRequest(http.MethodPost, "/auth/sign-in/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: "csrftoken", Value: "abcdefghijklmnopqrstuvwxyzABCDEF"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusFound || !strings.Contains(response.Header().Get("Location"), "error_code=5065") {
		t.Fatalf("status=%d location=%q", response.Code, response.Header().Get("Location"))
	}
	if store.session.Key != "" {
		t.Fatal("session created for invalid password")
	}
}

func TestSignInUnknownUser(t *testing.T) {
	store := &signInStoreStub{findErr: pgx.ErrNoRows}
	handler := SignInHandler{Store: store, AppBaseURL: "http://localhost:3000", SecretKey: "secret"}
	form := url.Values{"email": {"missing@example.com"}, "password": {"password"}, "csrfmiddlewaretoken": {"abcdefghijklmnopqrstuvwxyzABCDEF"}}
	req := httptest.NewRequest(http.MethodPost, "/auth/sign-in/", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: "csrftoken", Value: "abcdefghijklmnopqrstuvwxyzABCDEF"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if !strings.Contains(response.Header().Get("Location"), "error_code=5060") {
		t.Fatalf("location=%q", response.Header().Get("Location"))
	}
}

func testPassword(password string) string {
	iterations := 1200
	salt := "testsalt"
	hash := pbkdf2.Key([]byte(password), []byte(salt), iterations, 32, sha256.New)
	return "pbkdf2_sha256$1200$" + salt + "$" + base64.StdEncoding.EncodeToString(hash)
}
