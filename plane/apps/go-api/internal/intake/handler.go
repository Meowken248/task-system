package intake

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("intake not found")
	ErrInvalid      = errors.New("invalid intake")
)

type WritePayload struct {
	Name        *string         `json:"name"`
	Description *string         `json:"description"`
	IsDefault   *bool           `json:"is_default"`
	ViewProps   *map[string]any `json:"view_props"`
	LogoProps   *map[string]any `json:"logo_props"`
}

type Store interface {
	ListForSession(context.Context, string, string, string) (any, error)
	GetForSession(context.Context, string, string, string, string) (any, error)
	CreateForSession(context.Context, string, string, string, WritePayload) (any, error)
	UpdateForSession(context.Context, string, string, string, string, WritePayload) (any, error)
	DeleteForSession(context.Context, string, string, string, string) error
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "intake storage is unavailable"})
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
	projectID := r.PathValue("project_id")
	intakeID := r.PathValue("intake_id")

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		if intakeID != "" {
			payload, err = h.Store.GetForSession(r.Context(), sessionKey, slug, projectID, intakeID)
		} else {
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, projectID)
		}
	case http.MethodPost:
		var input WritePayload
		if decodeErr := json.NewDecoder(r.Body).Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, projectID, input)
		statusCode = http.StatusCreated
	case http.MethodPatch:
		if intakeID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "intake id required"})
			return
		}
		var input WritePayload
		if decodeErr := json.NewDecoder(r.Body).Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, projectID, intakeID, input)
	case http.MethodDelete:
		if intakeID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "intake id required"})
			return
		}
		err = h.Store.DeleteForSession(r.Context(), sessionKey, slug, projectID, intakeID)
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Intake does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		case err.Error() == "You cannot delete the default intake":
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "intake storage is unavailable"})
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
	_ = json.NewEncoder(w).Encode(payload)
}
