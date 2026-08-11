package workspacehomepreference

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
	ErrNotFound     = errors.New("preference not found")
	ErrInvalid      = errors.New("invalid payload")
)

type WorkspaceHomePreference struct {
	ID        string         `json:"id"`
	Workspace string         `json:"workspace"`
	User      string         `json:"user"`
	Key       string         `json:"key"`
	IsEnabled bool           `json:"is_enabled"`
	Config    map[string]any `json:"config"`
	SortOrder float64        `json:"sort_order"`
	CreatedAt any            `json:"created_at"`
	UpdatedAt any            `json:"updated_at"`
}

type WritePayload struct {
	IsEnabled *bool           `json:"is_enabled,omitempty"`
	Config    *map[string]any `json:"config,omitempty"`
	SortOrder *float64        `json:"sort_order,omitempty"`
}

type Store interface {
	ListForSession(ctx context.Context, sessionKey, slug string) ([]WorkspaceHomePreference, error)
	GetForSession(ctx context.Context, sessionKey, slug, key string) (WorkspaceHomePreference, error)
	UpdateForSession(ctx context.Context, sessionKey, slug, key string, payload WritePayload) (WorkspaceHomePreference, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "home preference storage is unavailable"})
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
	key := r.PathValue("key")

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		if key == "" {
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug)
		} else {
			payload, err = h.Store.GetForSession(r.Context(), sessionKey, slug, key)
		}
	case http.MethodPatch:
		if key == "" {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "preference key required"})
			return
		}
		var input WritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil && !errors.Is(decodeErr, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, key, input)
	default:
		w.Header().Set("Allow", "GET, PATCH")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Preference does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "preference storage is unavailable"})
		}
		return
	}

	writeJSON(w, statusCode, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if payload != nil {
		_ = json.NewEncoder(w).Encode(payload)
	}
}
