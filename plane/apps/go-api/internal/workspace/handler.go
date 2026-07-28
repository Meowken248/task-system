package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

var ErrUnauthorized = errors.New("authentication required")

type Lister interface {
	ListForSession(context.Context, string, []string) ([]map[string]any, error)
}

type Handler struct {
	Store             Lister
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace storage is unavailable"})
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
	fields := splitFields(r.URL.Query().Get("fields"))
	workspaces, err := h.Store.ListForSession(r.Context(), sessionKey, fields)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace storage is unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, workspaces)
}

func splitFields(value string) []string {
	parts := strings.Split(value, ",")
	fields := make([]string, 0, len(parts))
	for _, field := range parts {
		if field = strings.TrimSpace(field); field != "" {
			fields = append(fields, field)
		}
	}
	return fields
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
