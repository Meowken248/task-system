package state

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type Reader interface {
	ListForSession(context.Context, string, string, string) ([]map[string]any, error)
	GetForSession(context.Context, string, string, string, string) (map[string]any, error)
}

type Handler struct {
	Store             Reader
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "state storage is unavailable"})
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
	var payload any
	var err error
	if stateID := r.PathValue("state_id"); stateID != "" {
		payload, err = h.Store.GetForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), stateID)
	} else {
		states, listErr := h.Store.ListForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"))
		err = listErr
		if r.URL.Query().Get("grouped") == "true" {
			grouped := make(map[string][]map[string]any)
			for _, item := range states {
				group, _ := item["group"].(string)
				grouped[group] = append(grouped[group], item)
			}
			payload = grouped
		} else {
			payload = states
		}
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "State does not exist"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "state storage is unavailable"})
		}
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=10")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
