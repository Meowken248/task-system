package projectidentifier

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type mockStore struct {
	checkExistsFunc func(ctx context.Context, sessionKey, slug, name string) ([]ProjectIdentifier, error)
	deleteFunc      func(ctx context.Context, sessionKey, slug, name string) error
}

func (m *mockStore) CheckExists(ctx context.Context, sessionKey, slug, name string) ([]ProjectIdentifier, error) {
	return m.checkExistsFunc(ctx, sessionKey, slug, name)
}

func (m *mockStore) Delete(ctx context.Context, sessionKey, slug, name string) error {
	return m.deleteFunc(ctx, sessionKey, slug, name)
}

func TestHandler_Get(t *testing.T) {
	mockStore := &mockStore{
		checkExistsFunc: func(ctx context.Context, sessionKey, slug, name string) ([]ProjectIdentifier, error) {
			if sessionKey == "" {
				return nil, ErrUnauthorized
			}
			if slug == "invalid" {
				return nil, ErrForbidden
			}
			if name == "FOUND" {
				return []ProjectIdentifier{{ID: "1", Name: "FOUND", Project: "2"}}, nil
			}
			return []ProjectIdentifier{}, nil
		},
	}
	handler := Handler{Store: mockStore}
	mux := http.NewServeMux()
	mux.Handle("GET /api/workspaces/{slug}/project-identifiers/", handler)

	tests := []struct {
		name          string
		slug          string
		query         string
		sessionCookie string
		expectedCode  int
	}{
		{
			name:         "no session",
			slug:         "plane",
			query:        "name=TEST",
			expectedCode: http.StatusUnauthorized,
		},
		{
			name:          "forbidden",
			slug:          "invalid",
			query:         "name=TEST",
			sessionCookie: "valid",
			expectedCode:  http.StatusForbidden,
		},
		{
			name:          "missing name",
			slug:          "plane",
			query:         "",
			sessionCookie: "valid",
			expectedCode:  http.StatusBadRequest,
		},
		{
			name:          "not found name",
			slug:          "plane",
			query:         "name=NOTFOUND",
			sessionCookie: "valid",
			expectedCode:  http.StatusOK,
		},
		{
			name:          "found name",
			slug:          "plane",
			query:         "name=FOUND",
			sessionCookie: "valid",
			expectedCode:  http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/workspaces/"+tt.slug+"/project-identifiers/?"+tt.query, nil)
			if tt.sessionCookie != "" {
				req.AddCookie(&http.Cookie{Name: "sessionid", Value: tt.sessionCookie})
			}
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, req)

			if rr.Code != tt.expectedCode {
				t.Errorf("expected status %d, got %d. body: %s", tt.expectedCode, rr.Code, rr.Body.String())
			}
		})
	}
}

func TestHandler_Delete(t *testing.T) {
	mockStore := &mockStore{
		deleteFunc: func(ctx context.Context, sessionKey, slug, name string) error {
			if sessionKey == "" {
				return ErrUnauthorized
			}
			if slug == "invalid" {
				return ErrForbidden
			}
			if name == "INUSE" {
				return ErrInUse
			}
			return nil
		},
	}
	handler := Handler{Store: mockStore}
	mux := http.NewServeMux()
	mux.Handle("DELETE /api/workspaces/{slug}/project-identifiers/", handler)

	tests := []struct {
		name          string
		slug          string
		payload       map[string]any
		sessionCookie string
		expectedCode  int
	}{
		{
			name:         "no session",
			slug:         "plane",
			payload:      map[string]any{"name": "TEST"},
			expectedCode: http.StatusUnauthorized,
		},
		{
			name:          "forbidden",
			slug:          "invalid",
			payload:       map[string]any{"name": "TEST"},
			sessionCookie: "valid",
			expectedCode:  http.StatusForbidden,
		},
		{
			name:          "missing name",
			slug:          "plane",
			payload:       map[string]any{},
			sessionCookie: "valid",
			expectedCode:  http.StatusBadRequest,
		},
		{
			name:          "in use",
			slug:          "plane",
			payload:       map[string]any{"name": "INUSE"},
			sessionCookie: "valid",
			expectedCode:  http.StatusBadRequest,
		},
		{
			name:          "success",
			slug:          "plane",
			payload:       map[string]any{"name": "TEST"},
			sessionCookie: "valid",
			expectedCode:  http.StatusNoContent,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b, _ := json.Marshal(tt.payload)
			req := httptest.NewRequest(http.MethodDelete, "/api/workspaces/"+tt.slug+"/project-identifiers/", bytes.NewReader(b))
			if tt.sessionCookie != "" {
				req.AddCookie(&http.Cookie{Name: "sessionid", Value: tt.sessionCookie})
			}
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, req)

			if rr.Code != tt.expectedCode {
				t.Errorf("expected status %d, got %d. body: %s", tt.expectedCode, rr.Code, rr.Body.String())
			}
		})
	}
}
