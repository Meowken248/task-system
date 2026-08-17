package user

import (
	"context"
	"net/http"
)

type GraphStore interface {
	UserActivityGraph(ctx context.Context, sessionKey string, workspaceSlug string) ([]map[string]any, error)
	UserIssuesCompletedGraph(ctx context.Context, sessionKey string, workspaceSlug string, month int) ([]map[string]any, error)
}

type UserActivityGraphHandler struct {
	Store             GraphStore
	SessionCookieName string
}

func (h UserActivityGraphHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}

	if r.Method == http.MethodGet {
		// Mock implementation
		writeJSON(w, http.StatusOK, []map[string]any{})
		return
	}
	w.WriteHeader(http.StatusMethodNotAllowed)
}

type UserIssuesCompletedGraphHandler struct {
	Store             GraphStore
	SessionCookieName string
}

func (h UserIssuesCompletedGraphHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}

	if r.Method == http.MethodGet {
		// Mock implementation
		writeJSON(w, http.StatusOK, []map[string]any{})
		return
	}
	w.WriteHeader(http.StatusMethodNotAllowed)
}
