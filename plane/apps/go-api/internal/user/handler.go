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

type Store interface {
	Reader
	UpdateCurrentForSession(context.Context, string, map[string]any) (map[string]any, error)
}

type ProfileReader interface {
	ProfileForSession(context.Context, string) (map[string]any, error)
}

type ProfileStore interface {
	ProfileReader
	UpdateProfileForSession(context.Context, string, map[string]any) (map[string]any, error)
}

type ValidationError map[string]any

func (e ValidationError) Error() string { return "invalid user payload" }

type SettingsReader interface {
	SettingsForSession(context.Context, string) (map[string]any, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

type ProfileHandler struct {
	Store             ProfileStore
	SessionCookieName string
}

func (h ProfileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPatch {
		h.patch(w, r)
		return
	}
	serveSessionResource(w, r, h.SessionCookieName, func(ctx context.Context, session string) (map[string]any, error) {
		if h.Store == nil {
			return nil, errors.New("profile storage is unavailable")
		}
		return h.Store.ProfileForSession(ctx, session)
	})
}

func (h ProfileHandler) patch(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "profile storage is unavailable"})
		return
	}
	var payload map[string]any
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&payload); err != nil || payload == nil {
		writeJSON(w, http.StatusBadRequest, map[string][]string{"non_field_errors": {"Invalid JSON payload."}})
		return
	}
	profile, err := h.Store.UpdateProfileForSession(r.Context(), sessionFromRequest(r, h.SessionCookieName), payload)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		var validation ValidationError
		if errors.As(err, &validation) {
			writeJSON(w, http.StatusBadRequest, validation)
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func sessionFromRequest(r *http.Request, cookieName string) string {
	if cookieName == "" {
		cookieName = "session-id"
	}
	if cookie, err := r.Cookie(cookieName); err == nil {
		return cookie.Value
	}
	return ""
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
		cookieName = "session-id"
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
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if r.Method == http.MethodPatch {
		var payload map[string]any
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&payload); err != nil || payload == nil {
			writeJSON(w, http.StatusBadRequest, map[string][]string{"non_field_errors": {"Invalid JSON payload."}})
			return
		}
		current, err := h.Store.UpdateCurrentForSession(r.Context(), sessionKey, payload)
		if err != nil {
			if errors.Is(err, ErrUnauthorized) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
				return
			}
			var validation ValidationError
			if errors.As(err, &validation) {
				writeJSON(w, http.StatusBadRequest, validation)
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, current)
		return
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
