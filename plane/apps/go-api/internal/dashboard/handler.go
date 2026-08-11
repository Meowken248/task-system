package dashboard

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
	ErrNotFound     = errors.New("not found")
)

type Reader interface {
	GetWorkspaceDashboard(ctx context.Context, sessionKey, slug string, month int) (map[string]any, error)
}

type Handler struct {
	Store             Reader
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "dashboard storage is unavailable"})
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
	month := 1
	if m := r.URL.Query().Get("month"); m != "" {
		if parsedMonth, err := strconv.Atoi(m); err == nil {
			month = parsedMonth
		}
	}

	payload, err := h.Store.GetWorkspaceDashboard(r.Context(), sessionKey, slug, month)
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Workspace does not exist"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "dashboard storage is unavailable"})
		}
		return
	}

	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
