package cycle

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type cycleIssueStoreStub struct{}

func (s cycleIssueStoreStub) List(ctx context.Context, sessionKey, slug, projectID, cycleID string) ([]map[string]any, error) {
	if sessionKey == "unauth" {
		return nil, ErrUnauthorized
	}
	return []map[string]any{
		{"id": "issue-1", "cycle_id": cycleID},
	}, nil
}

func (s cycleIssueStoreStub) Create(ctx context.Context, sessionKey, slug, projectID, cycleID string, payload CycleIssueWritePayload) ([]CycleIssueItem, error) {
	if sessionKey == "unauth" {
		return nil, ErrUnauthorized
	}
	if len(payload.Issues) == 0 {
		return nil, ErrInvalid
	}
	return []CycleIssueItem{
		{ID: "bridge-1", IssueID: payload.Issues[0], CycleID: cycleID},
	}, nil
}

func (s cycleIssueStoreStub) Delete(ctx context.Context, sessionKey, slug, projectID, cycleID, issueID string) error {
	if sessionKey == "unauth" {
		return ErrUnauthorized
	}
	if issueID == "missing" {
		return ErrNotFound
	}
	return nil
}

func TestCycleIssueHandler_ServeHTTP(t *testing.T) {
	handler := CycleIssueHandler{Store: cycleIssueStoreStub{}}

	t.Run("GET list cycle issues", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/workspaces/slug1/projects/proj1/cycles/cycle1/cycle-issues/", nil)
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid"})
		req.SetPathValue("slug", "slug1")
		req.SetPathValue("project_id", "proj1")
		req.SetPathValue("cycle_id", "cycle1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rec.Code)
		}
	})

	t.Run("POST create cycle issue", func(t *testing.T) {
		payload := CycleIssueWritePayload{Issues: []string{"issue-1", "issue-2"}}
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/api/workspaces/slug1/projects/proj1/cycles/cycle1/cycle-issues/", bytes.NewReader(body))
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid"})
		req.SetPathValue("slug", "slug1")
		req.SetPathValue("project_id", "proj1")
		req.SetPathValue("cycle_id", "cycle1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", rec.Code)
		}
	})

	t.Run("DELETE cycle issue", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodDelete, "/api/workspaces/slug1/projects/proj1/cycles/cycle1/cycle-issues/issue1/", nil)
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid"})
		req.SetPathValue("slug", "slug1")
		req.SetPathValue("project_id", "proj1")
		req.SetPathValue("cycle_id", "cycle1")
		req.SetPathValue("issue_id", "issue1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Errorf("expected status 204, got %d", rec.Code)
		}
	})

	t.Run("Unauthorized", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/workspaces/slug1/projects/proj1/cycles/cycle1/cycle-issues/", nil)
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "unauth"})
		req.SetPathValue("slug", "slug1")
		req.SetPathValue("project_id", "proj1")
		req.SetPathValue("cycle_id", "cycle1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected status 401, got %d", rec.Code)
		}
	})
}
