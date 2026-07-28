package project

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type Reader interface {
	ListForSession(context.Context, string, string, bool, []string) ([]map[string]any, error)
	GetForSession(context.Context, string, string, string) (map[string]any, error)
}

type Handler struct {
	Store             Reader
	Legacy            http.Handler
	SessionCookieName string
	Detailed          bool
	Single            bool
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project storage is unavailable"})
		return
	}
	if !h.Single && (r.URL.Query().Has("cursor") || r.URL.Query().Has("per_page")) && h.Legacy != nil {
		h.Legacy.ServeHTTP(w, r)
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
	var payload any
	var err error
	if h.Single {
		payload, err = h.Store.GetForSession(r.Context(), sessionKey, slug, r.PathValue("project_id"))
	} else {
		payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, h.Detailed, splitFields(r.URL.Query().Get("fields")))
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Project does not exist"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project storage is unavailable"})
		}
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=10")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
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
