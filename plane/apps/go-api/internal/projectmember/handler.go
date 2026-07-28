package projectmember

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type Reader interface {
	ListForSession(context.Context, string, string, string) ([]Membership, error)
}

type CurrentReader interface {
	GetForSession(context.Context, string, string, string) (Membership, error)
}

type Handler struct {
	Store             Reader
	SessionCookieName string
	Current           bool
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project member storage is unavailable"})
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
	if h.Current {
		currentStore, ok := h.Store.(CurrentReader)
		if !ok {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "current project member storage is unavailable"})
			return
		}
		payload, err = currentStore.GetForSession(
			r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"),
		)
	} else {
		payload, err = h.Store.ListForSession(
			r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"),
		)
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project member storage is unavailable"})
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
