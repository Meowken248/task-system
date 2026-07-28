package user

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

var ErrUnauthorized = errors.New("authentication required")

type Reader interface {
	CurrentForSession(context.Context, string) (map[string]any, error)
}

type ProfileReader interface {
	ProfileForSession(context.Context, string) (map[string]any, error)
}

type SettingsReader interface {
	SettingsForSession(context.Context, string) (map[string]any, error)
}

type Handler struct {
	Store             Reader
	SessionCookieName string
}

type ProfileHandler struct {
	Store             ProfileReader
	SessionCookieName string
}

func (h ProfileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	serveSessionResource(w, r, h.SessionCookieName, func(ctx context.Context, session string) (map[string]any, error) {
		if h.Store == nil {
			return nil, errors.New("profile storage is unavailable")
		}
		return h.Store.ProfileForSession(ctx, session)
	})
}

type SettingsHandler struct {
	Store             SettingsReader
	SessionCookieName string
}

func (h SettingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	serveSessionResource(w, r, h.SessionCookieName, func(ctx context.Context, session string) (map[string]any, error) {
		if h.Store == nil {
			return nil, errors.New("settings storage is unavailable")
		}
		return h.Store.SettingsForSession(ctx, session)
	})
}

func serveSessionResource(w http.ResponseWriter, r *http.Request, cookieName string, read func(context.Context, string) (map[string]any, error)) {
	if cookieName == "" {
		cookieName = "sessionid"
	}
	sessionKey := ""
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}
	payload, err := read(r.Context(), sessionKey)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=12")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
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
	current, err := h.Store.CurrentForSession(r.Context(), sessionKey)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=12")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, current)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
