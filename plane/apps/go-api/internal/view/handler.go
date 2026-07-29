package view

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type Reader interface {
	ListForSession(context.Context, string, string, string) ([]ViewItem, error)
	CreateForSession(context.Context, string, string, string, WritePayload) (ViewItem, error)
	UpdateForSession(context.Context, string, string, string, string, WritePayload) (ViewItem, error)
	DeleteForSession(context.Context, string, string, string, string) error
}

type Handler struct {
	Store             Reader
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "view storage is unavailable"})
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
	viewID := r.PathValue("view_id")

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, projectID)
	case http.MethodPost:
		var input WritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, projectID, input)
		statusCode = http.StatusCreated
	case http.MethodPatch:
		if viewID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "view id required"})
			return
		}
		var input WritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, projectID, viewID, input)
	case http.MethodDelete:
		if viewID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "view id required"})
			return
		}
		err = h.Store.DeleteForSession(r.Context(), sessionKey, slug, projectID, viewID)
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "View does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "view storage is unavailable"})
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
