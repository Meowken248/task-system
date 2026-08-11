package workspacehomepreference

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	payload WorkspaceHomePreference
	err     error
}

func (s storeStub) ListForSession(ctx context.Context, sessionKey, slug string) ([]WorkspaceHomePreference, error) {
	return []WorkspaceHomePreference{s.payload}, s.err
}

func (s storeStub) GetForSession(ctx context.Context, sessionKey, slug, key string) (WorkspaceHomePreference, error) {
	return s.payload, s.err
}

func (s storeStub) UpdateForSession(ctx context.Context, sessionKey, slug, key string, payload WritePayload) (WorkspaceHomePreference, error) {
	return s.payload, s.err
}

func TestListPreferences(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/home-preferences/", nil)
	req.SetPathValue("slug", "demo")
	res := httptest.NewRecorder()

	Handler{Store: storeStub{payload: WorkspaceHomePreference{ID: "pref-1"}}}.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestUpdatePreference(t *testing.T) {
	req := httptest.NewRequest(http.MethodPatch, "/home-preferences/my_stickies/", strings.NewReader(`{"is_enabled":false}`))
	req.SetPathValue("slug", "demo")
	req.SetPathValue("key", "my_stickies")
	res := httptest.NewRecorder()

	Handler{Store: storeStub{payload: WorkspaceHomePreference{ID: "pref-1"}}}.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestErrors(t *testing.T) {
	tests := []struct {
		err  error
		want int
	}{
		{ErrUnauthorized, http.StatusUnauthorized},
		{ErrForbidden, http.StatusForbidden},
		{ErrNotFound, http.StatusNotFound},
		{ErrInvalid, http.StatusBadRequest},
	}

	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, "/home-preferences/", nil)
		res := httptest.NewRecorder()
		Handler{Store: storeStub{err: tc.err}}.ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("err=%v status=%d, want %d", tc.err, res.Code, tc.want)
		}
	}
}
