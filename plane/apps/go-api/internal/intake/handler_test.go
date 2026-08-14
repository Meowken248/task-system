package intake_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/makeplane/plane/apps/go-api/internal/intake"
)

type mockStore struct {
	listForSession   func(ctx context.Context, sessionKey, slug, projectID string) (any, error)
	getForSession    func(ctx context.Context, sessionKey, slug, projectID, intakeID string) (any, error)
	createForSession func(ctx context.Context, sessionKey, slug, projectID string, payload intake.WritePayload) (any, error)
	updateForSession func(ctx context.Context, sessionKey, slug, projectID, intakeID string, payload intake.WritePayload) (any, error)
	deleteForSession func(ctx context.Context, sessionKey, slug, projectID, intakeID string) error
}

func (m mockStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) (any, error) {
	return m.listForSession(ctx, sessionKey, slug, projectID)
}
func (m mockStore) GetForSession(ctx context.Context, sessionKey, slug, projectID, intakeID string) (any, error) {
	return m.getForSession(ctx, sessionKey, slug, projectID, intakeID)
}
func (m mockStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID string, payload intake.WritePayload) (any, error) {
	return m.createForSession(ctx, sessionKey, slug, projectID, payload)
}
func (m mockStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, intakeID string, payload intake.WritePayload) (any, error) {
	return m.updateForSession(ctx, sessionKey, slug, projectID, intakeID, payload)
}
func (m mockStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, intakeID string) error {
	return m.deleteForSession(ctx, sessionKey, slug, projectID, intakeID)
}

func TestIntakeHandler(t *testing.T) {
	mockItem := map[string]any{"id": "intake-1", "name": "Intake 1"}
	
	store := mockStore{
		listForSession: func(ctx context.Context, sessionKey, slug, projectID string) (any, error) {
			if sessionKey == "bad" || sessionKey == "" {
				return nil, intake.ErrUnauthorized
			}
			return mockItem, nil
		},
		getForSession: func(ctx context.Context, sessionKey, slug, projectID, intakeID string) (any, error) {
			if intakeID == "missing" {
				return nil, intake.ErrNotFound
			}
			return mockItem, nil
		},
		createForSession: func(ctx context.Context, sessionKey, slug, projectID string, payload intake.WritePayload) (any, error) {
			return mockItem, nil
		},
		updateForSession: func(ctx context.Context, sessionKey, slug, projectID, intakeID string, payload intake.WritePayload) (any, error) {
			return mockItem, nil
		},
		deleteForSession: func(ctx context.Context, sessionKey, slug, projectID, intakeID string) error {
			if intakeID == "default-intake" {
				return errors.New("You cannot delete the default intake")
			}
			return nil
		},
	}

	h := intake.Handler{Store: store, SessionCookieName: "sessionid"}
	router := http.NewServeMux()
	router.Handle("GET /api/workspaces/{slug}/projects/{project_id}/intakes/", h)
	router.Handle("POST /api/workspaces/{slug}/projects/{project_id}/intakes/", h)
	router.Handle("GET /api/workspaces/{slug}/projects/{project_id}/intakes/{intake_id}/", h)
	router.Handle("PATCH /api/workspaces/{slug}/projects/{project_id}/intakes/{intake_id}/", h)
	router.Handle("DELETE /api/workspaces/{slug}/projects/{project_id}/intakes/{intake_id}/", h)

	tests := []struct {
		method string
		url    string
		cookie string
		body   any
		status int
	}{
		{"GET", "/api/workspaces/w/projects/p/intakes/", "good", nil, http.StatusOK},
		{"GET", "/api/workspaces/w/projects/p/intakes/", "bad", nil, http.StatusUnauthorized},
		{"GET", "/api/workspaces/w/projects/p/intakes/", "", nil, http.StatusUnauthorized},
		
		{"GET", "/api/workspaces/w/projects/p/intakes/intake-1/", "good", nil, http.StatusOK},
		{"GET", "/api/workspaces/w/projects/p/intakes/missing/", "good", nil, http.StatusNotFound},
		
		{"POST", "/api/workspaces/w/projects/p/intakes/", "good", map[string]any{"name": "New"}, http.StatusCreated},
		{"POST", "/api/workspaces/w/projects/p/intakes/", "good", "bad json", http.StatusBadRequest},

		{"PATCH", "/api/workspaces/w/projects/p/intakes/intake-1/", "good", map[string]any{"name": "Updated"}, http.StatusOK},
		
		{"DELETE", "/api/workspaces/w/projects/p/intakes/intake-1/", "good", nil, http.StatusNoContent},
		{"DELETE", "/api/workspaces/w/projects/p/intakes/default-intake/", "good", nil, http.StatusBadRequest},
	}

	for _, tt := range tests {
		var req *http.Request
		if tt.body != nil {
			if s, ok := tt.body.(string); ok {
				req = httptest.NewRequest(tt.method, tt.url, bytes.NewBufferString(s))
			} else {
				b, _ := json.Marshal(tt.body)
				req = httptest.NewRequest(tt.method, tt.url, bytes.NewBuffer(b))
			}
		} else {
			req = httptest.NewRequest(tt.method, tt.url, nil)
		}
		
		if tt.cookie != "" {
			req.AddCookie(&http.Cookie{Name: "sessionid", Value: tt.cookie})
		}
		
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		
		if w.Code != tt.status {
			t.Errorf("expected status %d, got %d for %s %s. body: %s", tt.status, w.Code, tt.method, tt.url, w.Body.String())
		}
	}
}
