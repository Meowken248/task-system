package user

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readerStub struct {
	current map[string]any
	err     error
	session string
	updated map[string]any
}

func (s *readerStub) UpdateCurrentForSession(_ context.Context, session string, payload map[string]any) (map[string]any, error) {
	s.session = session
	s.updated = payload
	return s.current, s.err
}

type profileReaderStub struct {
	profile map[string]any
	err     error
	session string
	updated map[string]any
}

func (s *profileReaderStub) UpdateProfileForSession(_ context.Context, session string, payload map[string]any) (map[string]any, error) {
	s.session = session
	s.updated = payload
	return s.profile, s.err
}

func (s *profileReaderStub) ProfileForSession(_ context.Context, session string) (map[string]any, error) {
	s.session = session
	return s.profile, s.err
}

type settingsReaderStub struct {
	settings map[string]any
	err      error
	session  string
}

func (s *settingsReaderStub) SettingsForSession(_ context.Context, session string) (map[string]any, error) {
	s.session = session
	return s.settings, s.err
}

func (s *readerStub) CurrentForSession(_ context.Context, session string) (map[string]any, error) {
	s.session = session
	return s.current, s.err
}

func TestHandlerReturnsCurrentUser(t *testing.T) {
	store := &readerStub{current: map[string]any{"id": "user-id"}}
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/", nil)
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "valid-session"})
	res := httptest.NewRecorder()
	Handler{Store: store, SessionCookieName: "session-id"}.ServeHTTP(res, req)
	if res.Code != http.StatusOK || store.session != "valid-session" {
		t.Fatalf("status=%d session=%q", res.Code, store.session)
	}
	if res.Header().Get("Cache-Control") != "private, max-age=12" {
		t.Fatalf("unexpected cache header: %q", res.Header().Get("Cache-Control"))
	}
}

func TestHandlerRejectsInvalidSession(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/", nil)
	res := httptest.NewRecorder()
	Handler{Store: &readerStub{err: ErrUnauthorized}}.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", res.Code)
	}
}

func TestHandlerUpdatesCurrentUser(t *testing.T) {
	store := &readerStub{current: map[string]any{"display_name": "Plane User"}}
	req := httptest.NewRequest(http.MethodPatch, "/api/users/me/", bytes.NewBufferString(`{"display_name":"Plane User"}`))
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "valid-session"})
	res := httptest.NewRecorder()
	Handler{Store: store, SessionCookieName: "session-id"}.ServeHTTP(res, req)
	if res.Code != http.StatusOK || store.session != "valid-session" || store.updated["display_name"] != "Plane User" {
		t.Fatalf("status=%d session=%q payload=%v", res.Code, store.session, store.updated)
	}
}

func TestHandlerRejectsInvalidPatchJSON(t *testing.T) {
	res := httptest.NewRecorder()
	Handler{Store: &readerStub{}}.ServeHTTP(res, httptest.NewRequest(http.MethodPatch, "/", bytes.NewBufferString(`{`)))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", res.Code)
	}
}

func TestHandlerReturnsServiceUnavailableOnStoreFailure(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/", nil)
	res := httptest.NewRecorder()
	Handler{Store: &readerStub{err: errors.New("database down")}}.ServeHTTP(res, req)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", res.Code)
	}
}

func TestProfileHandlerReturnsProfile(t *testing.T) {
	store := &profileReaderStub{profile: map[string]any{"id": "profile-id"}}
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/profile/", nil)
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "valid-session"})
	res := httptest.NewRecorder()
	ProfileHandler{Store: store, SessionCookieName: "session-id"}.ServeHTTP(res, req)
	if res.Code != http.StatusOK || store.session != "valid-session" {
		t.Fatalf("status=%d session=%q", res.Code, store.session)
	}
}

func TestSettingsHandlerReturnsSettings(t *testing.T) {
	store := &settingsReaderStub{settings: map[string]any{"workspace": map[string]any{"slug": "demo"}}}
	req := httptest.NewRequest(http.MethodGet, "/api/users/me/settings/", nil)
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "valid-session"})
	res := httptest.NewRecorder()
	SettingsHandler{Store: store, SessionCookieName: "session-id"}.ServeHTTP(res, req)
	if res.Code != http.StatusOK || store.session != "valid-session" {
		t.Fatalf("status=%d session=%q", res.Code, store.session)
	}
}

func TestProfileHandlerUpdatesProfile(t *testing.T) {
	store := &profileReaderStub{profile: map[string]any{"language": "vi"}}
	req := httptest.NewRequest(http.MethodPatch, "/api/users/me/profile/", bytes.NewBufferString(`{"language":"vi"}`))
	req.AddCookie(&http.Cookie{Name: "session-id", Value: "valid-session"})
	res := httptest.NewRecorder()
	ProfileHandler{Store: store, SessionCookieName: "session-id"}.ServeHTTP(res, req)
	if res.Code != http.StatusOK || store.session != "valid-session" || store.updated["language"] != "vi" {
		t.Fatalf("status=%d session=%q payload=%v", res.Code, store.session, store.updated)
	}
}

func TestProfileHandlerRejectsInvalidJSON(t *testing.T) {
	res := httptest.NewRecorder()
	ProfileHandler{Store: &profileReaderStub{}}.ServeHTTP(res, httptest.NewRequest(http.MethodPatch, "/", bytes.NewBufferString(`{`)))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", res.Code)
	}
}

func TestProfileAndSettingsRejectInvalidSession(t *testing.T) {
	for name, handler := range map[string]http.Handler{
		"profile":  ProfileHandler{Store: &profileReaderStub{err: ErrUnauthorized}},
		"settings": SettingsHandler{Store: &settingsReaderStub{err: ErrUnauthorized}},
	} {
		t.Run(name, func(t *testing.T) {
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))
			if res.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", res.Code)
			}
		})
	}
}
