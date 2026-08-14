package instance

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/makeplane/plane/apps/go-api/internal/auth"
)

type storeStub struct {
	instance      *Instance
	configs       []InstanceConfiguration
	user          *User
	admin         *InstanceAdmin
	sessionUserID string
	loginSession  *auth.LoginSession
	err           error
}

func (s storeStub) GetInstance(context.Context) (*Instance, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.instance, nil
}
func (storeStub) CreateInstance(context.Context, *Instance) error { return nil }
func (storeStub) UpdateInstance(context.Context, *Instance) error { return nil }
func (storeStub) CreateUser(context.Context, *User) error         { return nil }
func (s storeStub) GetUserByEmail(_ context.Context, email string) (*User, error) {
	if s.user == nil || !strings.EqualFold(s.user.Email, email) {
		return nil, errors.New("not found")
	}
	return s.user, nil
}
func (s storeStub) GetUserByID(_ context.Context, id string) (*User, error) {
	if s.user == nil || s.user.ID != id {
		return nil, errors.New("not found")
	}
	return s.user, nil
}
func (storeStub) CreateInstanceAdmin(context.Context, *InstanceAdmin) error  { return nil }
func (storeStub) GetInstanceAdmins(context.Context) ([]InstanceAdmin, error) { return nil, nil }
func (s storeStub) GetInstanceAdminByUserID(_ context.Context, userID string) (*InstanceAdmin, error) {
	if s.admin == nil || s.admin.UserID != userID {
		return nil, errors.New("not found")
	}
	return s.admin, nil
}
func (storeStub) DeleteInstanceAdmin(context.Context, string) error { return nil }
func (s storeStub) GetConfigurations(context.Context) ([]InstanceConfiguration, error) {
	return s.configs, nil
}
func (storeStub) UpdateConfiguration(context.Context, *InstanceConfiguration) error { return nil }

func (s storeStub) UpdateEmailConfigurationDisabled(context.Context) error { return nil }
func (s storeStub) CheckWorkspaceSlug(ctx context.Context, slug string) (bool, error) {
	return false, nil
}
func (s storeStub) ListWorkspaces(ctx context.Context, search string, limit, offset int) ([]map[string]any, int, error) {
	return nil, 0, nil
}
func (s storeStub) UpdateInstanceAdmin(ctx context.Context, id string, role int) error { return nil }

func (s storeStub) CreateLoginSession(_ context.Context, session auth.LoginSession) error {
	if s.loginSession != nil {
		*s.loginSession = session
	}
	return nil
}
func (s storeStub) GetUserIDBySessionKey(_ context.Context, sessionKey string) (string, error) {
	if sessionKey == "" || s.sessionUserID == "" {
		return "", errors.New("unauthorized")
	}
	return s.sessionUserID, nil
}

func TestHandlerReturnsInstanceAndConfiguration(t *testing.T) {
	value := "true"
	handler := NewHandler(storeStub{
		instance: &Instance{ID: "instance-1", InstanceName: "Plane", IsSetupDone: true},
		configs:  []InstanceConfiguration{{Key: "is_signup_enabled", Value: &value}},
	}, "sessionid")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/instances/", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	instancePayload, ok := payload["instance"].(map[string]any)
	if !ok || instancePayload["id"] != "instance-1" {
		t.Fatalf("unexpected instance payload: %#v", payload["instance"])
	}
}

func TestHandlerReturnsSetupFalseWhenInstanceMissing(t *testing.T) {
	handler := NewHandler(storeStub{err: errors.New("not found")}, "sessionid")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/instances/", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	instancePayload, ok := payload["instance"].(map[string]any)
	if !ok {
		t.Fatalf("instance payload = %#v, want object", payload["instance"])
	}
	if instancePayload["is_setup_done"] != false {
		t.Fatalf("is_setup_done = %#v, want false", instancePayload["is_setup_done"])
	}
	if _, ok := payload["config"].(map[string]any); !ok {
		t.Fatalf("config payload = %#v, want object", payload["config"])
	}
}

func TestHandlerProtectsInstanceMutation(t *testing.T) {
	handler := NewHandler(storeStub{instance: &Instance{ID: "instance-1"}}, "sessionid")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPatch, "/api/instances/", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}
func TestHandlerResolvesAdminMeFromSessionKey(t *testing.T) {
	handler := NewHandler(storeStub{
		sessionUserID: "user-1",
		user:          &User{ID: "user-1", Email: "admin@example.com", FirstName: "Admin", IsActive: true},
		admin:         &InstanceAdmin{ID: "admin-1", UserID: "user-1", InstanceID: "instance-1", Role: 20},
	}, "session-id")
	request := httptest.NewRequest(http.MethodGet, "/api/instances/admins/me/", nil)
	request.AddCookie(&http.Cookie{Name: "session-id", Value: "stored-session-key"})
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if payload["id"] != "user-1" {
		t.Fatalf("id = %#v, want user-1", payload["id"])
	}
}

func TestAdminSignInCreatesPersistentSessionCookie(t *testing.T) {
	passwordHash, err := auth.EncodeDjangoPassword("Strong!Pass123")
	if err != nil {
		t.Fatal(err)
	}
	var persisted auth.LoginSession
	handler := NewHandler(storeStub{
		user:         &User{ID: "user-1", Email: "admin@example.com", Password: passwordHash, IsActive: true},
		admin:        &InstanceAdmin{ID: "admin-1", UserID: "user-1", InstanceID: "instance-1", Role: 20},
		loginSession: &persisted,
	}, "session-id").ConfigureSession("test-secret", "", time.Hour)
	form := url.Values{"email": {"ADMIN@example.com"}, "password": {"Strong!Pass123"}}
	request := httptest.NewRequest(http.MethodPost, "/api/instances/admins/sign-in/", strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Origin", "http://localhost:3001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302; body=%s", response.Code, response.Body.String())
	}
	if persisted.UserID != "user-1" || persisted.Key == "" || persisted.Data == "" {
		t.Fatalf("session was not persisted: %#v", persisted)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Value != persisted.Key || cookies[0].Value == "user-1" {
		t.Fatalf("unexpected session cookie: %#v", cookies)
	}
	if location := response.Header().Get("Location"); location != "http://localhost:3001/god-mode/general/" {
		t.Fatalf("location = %q", location)
	}
}

func TestUpdateAdmin(t *testing.T) {
	handler := NewHandler(storeStub{
		sessionUserID: "user-1",
		admin:         &InstanceAdmin{ID: "admin-1", UserID: "user-1", Role: 20}, // Admin role >= 15
	}, "sessionid")
	response := httptest.NewRecorder()

	req := httptest.NewRequest(http.MethodPatch, "/api/instances/admins/target-id/", strings.NewReader(`{"role": 15}`))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid"})

	handler.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
}

func TestUpdateAdmin_Forbidden(t *testing.T) {
	handler := NewHandler(storeStub{
		sessionUserID: "user-1",
		admin:         &InstanceAdmin{ID: "admin-1", UserID: "user-1", Role: 5}, // Role < 15
	}, "sessionid")
	response := httptest.NewRecorder()

	req := httptest.NewRequest(http.MethodPatch, "/api/instances/admins/target-id/", strings.NewReader(`{"role": 15}`))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid"})

	handler.ServeHTTP(response, req)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", response.Code)
	}
}
