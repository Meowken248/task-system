package label

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type WritePayload struct {
	Name        *string `json:"name"`
	Color       *string `json:"color"`
	Description *string `json:"description"`
}

type Reader interface {
	ListForSession(context.Context, string, string, string) ([]Item, error)
	GetForSession(context.Context, string, string, string, string) (Item, error)
	CreateForSession(context.Context, string, string, string, WritePayload) (Item, error)
	UpdateForSession(context.Context, string, string, string, string, WritePayload) (Item, error)
	DeleteForSession(context.Context, string, string, string, string) error
}

type Handler struct {
	Store             Reader
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "label storage is unavailable"})
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
	labelID := r.PathValue("label_id")

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		if labelID != "" {
			payload, err = h.Store.GetForSession(r.Context(), sessionKey, slug, projectID, labelID)
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
		if labelID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "label id required"})
			return
		}
		var input WritePayload
		if decodeErr := json.NewDecoder(r.Body).Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, projectID, labelID, input)
	case http.MethodDelete:
		if labelID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "label id required"})
			return
		}
		err = h.Store.DeleteForSession(r.Context(), sessionKey, slug, projectID, labelID)
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Label does not exist"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "label storage is unavailable"})
		}
		return
	}

	if statusCode == http.StatusNoContent {
		w.WriteHeader(statusCode)
		return
	}

	if r.Method == http.MethodGet {
		w.Header().Set("Cache-Control", "private, max-age=10")
		w.Header().Add("Vary", "Cookie")
	}
	writeJSON(w, statusCode, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
