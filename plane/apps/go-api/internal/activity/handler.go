package activity

import (
	"encoding/json"
	"errors"
	"net/http"
)

// Handler serves the issue history/activity endpoint (read-only).
type Handler struct {
	Store             PostgreSQLStore
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "activity storage is unavailable"})
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	sessionKey := ""
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}
	slug := r.PathValue("slug")
	projectID := r.PathValue("project_id")
	issueID := r.PathValue("issue_id")
	activityType := r.URL.Query().Get("activity_type")
	createdAtGt := r.URL.Query().Get("created_at__gt")

	payload, err := h.Store.ListForSession(r.Context(), sessionKey, slug, projectID, issueID, activityType, createdAtGt)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "activity storage is unavailable"})
		}
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=5")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
