package analytic

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
)

type Store interface {
	ListForSession(context.Context, string, string) ([]AnalyticView, error)
	ProjectStatsForSession(ctx context.Context, sessionKey, slug string, projectIDs []string, fields []string) ([]map[string]any, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "analytics storage is unavailable"})
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie.Value == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}
	views, err := h.Store.ListForSession(r.Context(), cookie.Value, r.PathValue("slug"))
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "analytics storage is unavailable"})
		}
		return
	}
	writeJSON(w, http.StatusOK, views)
}

type ProjectStatsHandler struct {
	Store             Store
	SessionCookieName string
}

func (h ProjectStatsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "analytics storage is unavailable"})
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
	fieldsStr := r.URL.Query().Get("fields")
	var fields []string
	if fieldsStr != "" {
		fields = strings.Split(fieldsStr, ",")
	}
	projectIDsStr := r.URL.Query().Get("project_ids")
	var projectIDs []string
	if projectIDsStr != "" {
		projectIDs = strings.Split(projectIDsStr, ",")
	}

	payload, err := h.Store.ProjectStatsForSession(r.Context(), sessionKey, slug, projectIDs, fields)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "analytics storage is unavailable"})
		}
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
