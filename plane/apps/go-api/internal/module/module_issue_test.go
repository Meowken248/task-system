package module

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type moduleIssueStoreStub struct{}

func (s moduleIssueStoreStub) List(ctx context.Context, sessionKey, slug, projectID, moduleID string) ([]map[string]any, error) {
	if sessionKey == "unauth" {
		return nil, ErrUnauthorized
	}
	return []map[string]any{
		{"id": "issue-1", "module_id": moduleID},
	}, nil
}

func (s moduleIssueStoreStub) Create(ctx context.Context, sessionKey, slug, projectID, moduleID string, payload ModuleIssueWritePayload) ([]ModuleIssueItem, error) {
	if sessionKey == "unauth" {
		return nil, ErrUnauthorized
	}
	if len(payload.Issues) == 0 {
		return nil, ErrInvalid
	}
	return []ModuleIssueItem{
		{ID: "bridge-1", IssueID: payload.Issues[0], ModuleID: moduleID},
	}, nil
}

func (s moduleIssueStoreStub) Delete(ctx context.Context, sessionKey, slug, projectID, moduleID, issueID string) error {
	if sessionKey == "unauth" {
		return ErrUnauthorized
	}
	if issueID == "missing" {
		return ErrNotFound
	}
	return nil
}

func TestModuleIssueHandler_ServeHTTP(t *testing.T) {
	handler := ModuleIssueHandler{Store: moduleIssueStoreStub{}}

	t.Run("GET list module issues", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/workspaces/slug1/projects/proj1/modules/module1/module-issues/", nil)
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid"})
		req.SetPathValue("slug", "slug1")
		req.SetPathValue("project_id", "proj1")
		req.SetPathValue("module_id", "module1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rec.Code)
		}
	})

	t.Run("POST create module issue", func(t *testing.T) {
		payload := ModuleIssueWritePayload{Issues: []string{"issue-1", "issue-2"}}
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/api/workspaces/slug1/projects/proj1/modules/module1/module-issues/", bytes.NewReader(body))
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid"})
		req.SetPathValue("slug", "slug1")
		req.SetPathValue("project_id", "proj1")
		req.SetPathValue("module_id", "module1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rec.Code)
		}
	})

	t.Run("DELETE module issue", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/workspaces/slug1/projects/proj1/modules/module1/module-issues/issue1/", nil)
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid"})
		req.SetPathValue("slug", "slug1")
		req.SetPathValue("project_id", "proj1")
		req.SetPathValue("module_id", "module1")
		req.SetPathValue("issue_id", "issue1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Errorf("expected status 204, got %d", rec.Code)
		}
	})

	t.Run("Unauthorized", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/workspaces/slug1/projects/proj1/modules/module1/module-issues/", nil)
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "unauth"})
		req.SetPathValue("slug", "slug1")
		req.SetPathValue("project_id", "proj1")
		req.SetPathValue("module_id", "module1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected status 401, got %d", rec.Code)
		}
	})
}
