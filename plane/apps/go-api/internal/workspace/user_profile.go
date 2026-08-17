package workspace

import (
	"context"
	"net/http"
)

type UserProfileStore interface {
	UserStats(ctx context.Context, sessionKey, workspaceSlug, userID string) (map[string]any, error)
	UserProfile(ctx context.Context, sessionKey, workspaceSlug, userID string) (map[string]any, error)
	UserActivity(ctx context.Context, sessionKey, workspaceSlug, userID string, limit, offset int) (map[string]any, error)
	UserIssues(ctx context.Context, sessionKey, workspaceSlug, userID string, limit, offset int) (map[string]any, error)
}

type UserStatsHandler struct {
	Store             UserProfileStore
	SessionCookieName string
}
func (h UserStatsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	sessionKey := ""
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{})
}

type UserProfileHandler struct {
	Store             UserProfileStore
	SessionCookieName string
}
func (h UserProfileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	sessionKey := ""
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{})
}

type UserActivityHandler struct {
	Store             UserProfileStore
	SessionCookieName string
}
func (h UserActivityHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	sessionKey := ""
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{})
}

type UserIssuesHandler struct {
	Store             UserProfileStore
	SessionCookieName string
}
func (h UserIssuesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	sessionKey := ""
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{})
}
