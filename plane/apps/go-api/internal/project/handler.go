package project

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type Reader interface {
	ListForSession(context.Context, string, string, bool, []string) ([]map[string]any, error)
	GetForSession(context.Context, string, string, string) (map[string]any, error)
	CreateForSession(context.Context, string, string, ProjectPayload) (map[string]any, error)
	UpdateForSession(context.Context, string, string, string, map[string]any) (map[string]any, error)
	DeleteForSession(context.Context, string, string, string) error
}

type Handler struct {
	Store             Reader
	Legacy            http.Handler
	SessionCookieName string
	Detailed          bool
	Single            bool
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project storage is unavailable"})
		return
	}
	if !h.Single && (r.URL.Query().Has("cursor") || r.URL.Query().Has("per_page")) && h.Legacy != nil {
		h.Legacy.ServeHTTP(w, r)
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

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		if h.Single {
			payload, err = h.Store.GetForSession(r.Context(), sessionKey, slug, projectID)
		} else {
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, h.Detailed, splitFields(r.URL.Query().Get("fields")))
		}
	case http.MethodPost:
		var input ProjectPayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid project payload."})
			return
		}
		payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, input)
		statusCode = http.StatusCreated
	case http.MethodPatch:
		if projectID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "project id required"})
			return
		}
		var input map[string]any
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, projectID, input)
	case http.MethodDelete:
		if projectID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "project id required"})
			return
		}
		err = h.Store.DeleteForSession(r.Context(), sessionKey, slug, projectID)
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Project does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project storage is unavailable"})
		}
		return
	}

	if statusCode == http.StatusNoContent {
		w.WriteHeader(statusCode)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=10")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, statusCode, payload)
}

func splitFields(value string) []string {
	parts := strings.Split(value, ",")
	fields := make([]string, 0, len(parts))
	for _, field := range parts {
		if field = strings.TrimSpace(field); field != "" {
			fields = append(fields, field)
		}
	}
	return fields
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
