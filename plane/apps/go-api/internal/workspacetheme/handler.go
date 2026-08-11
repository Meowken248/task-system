package workspacetheme

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
	ErrNotFound     = errors.New("theme not found")
	ErrInvalid      = errors.New("invalid payload")
)

type WorkspaceTheme struct {
	ID        string         `json:"id"`
	Workspace string         `json:"workspace"`
	Name      string         `json:"name"`
	Actor     string         `json:"actor"`
	Colors    map[string]any `json:"colors"`
	CreatedAt any            `json:"created_at"`
	UpdatedAt any            `json:"updated_at"`
}

type WritePayload struct {
	Name   *string         `json:"name,omitempty"`
	Colors *map[string]any `json:"colors,omitempty"`
}

type Store interface {
	ListForSession(ctx context.Context, sessionKey, slug string) ([]WorkspaceTheme, error)
	GetForSession(ctx context.Context, sessionKey, slug, themeID string) (WorkspaceTheme, error)
	CreateForSession(ctx context.Context, sessionKey, slug string, payload WritePayload) (WorkspaceTheme, error)
	UpdateForSession(ctx context.Context, sessionKey, slug, themeID string, payload WritePayload) (WorkspaceTheme, error)
	DeleteForSession(ctx context.Context, sessionKey, slug, themeID string) error
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace theme storage is unavailable"})
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
	themeID := r.PathValue("theme_id")

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		if themeID == "" {
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug)
		} else {
			payload, err = h.Store.GetForSession(r.Context(), sessionKey, slug, themeID)
		}
	case http.MethodPost:
		var input WritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil && !errors.Is(decodeErr, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		if input.Name == nil || *input.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"name": "This field is required."})
			return
		}
		payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, input)
		statusCode = http.StatusCreated
	case http.MethodPatch:
		if themeID == "" {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "theme id required"})
			return
		}
		var input WritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil && !errors.Is(decodeErr, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, themeID, input)
	case http.MethodDelete:
		if themeID == "" {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "theme id required"})
			return
		}
		err = h.Store.DeleteForSession(r.Context(), sessionKey, slug, themeID)
		statusCode = http.StatusNoContent
	default:
		w.Header().Set("Allow", "GET, POST, PATCH, DELETE")
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Theme does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "theme storage is unavailable"})
		}
		return
	}

	if statusCode == http.StatusNoContent {
		w.WriteHeader(statusCode)
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
