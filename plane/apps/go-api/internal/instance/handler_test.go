package instance

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type storeStub struct {
	instance *Instance
	configs  []InstanceConfiguration
	err      error
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
func (storeStub) GetUserByEmail(context.Context, string) (*User, error) {
	return nil, errors.New("not found")
}
func (storeStub) GetUserByID(context.Context, string) (*User, error) {
	return nil, errors.New("not found")
}
func (storeStub) CreateInstanceAdmin(context.Context, *InstanceAdmin) error  { return nil }
func (storeStub) GetInstanceAdmins(context.Context) ([]InstanceAdmin, error) { return nil, nil }
func (storeStub) GetInstanceAdminByUserID(context.Context, string) (*InstanceAdmin, error) {
	return nil, errors.New("not found")
}
func (storeStub) DeleteInstanceAdmin(context.Context, string) error { return nil }
func (s storeStub) GetConfigurations(context.Context) ([]InstanceConfiguration, error) {
	return s.configs, nil
}
func (storeStub) UpdateConfiguration(context.Context, *InstanceConfiguration) error { return nil }
func (storeStub) GetUserIDBySessionKey(context.Context, string) (string, error) {
	return "", errors.New("unauthorized")
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
	if payload["is_setup_done"] != false {
		t.Fatalf("is_setup_done = %#v, want false", payload["is_setup_done"])
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
