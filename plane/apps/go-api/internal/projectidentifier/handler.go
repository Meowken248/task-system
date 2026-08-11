package projectidentifier

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
	ErrInUse        = errors.New("identifier in use")
)

type ProjectIdentifier struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Project string `json:"project"`
}

type Store interface {
	CheckExists(ctx context.Context, sessionKey, slug, name string) ([]ProjectIdentifier, error)
	Delete(ctx context.Context, sessionKey, slug, name string) error
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project identifier storage is unavailable"})
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

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		name := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("name")))
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Name is required"})
			return
		}
		identifiers, getErr := h.Store.CheckExists(r.Context(), sessionKey, slug, name)
		if getErr != nil {
			err = getErr
		} else {
			if identifiers == nil {
				identifiers = []ProjectIdentifier{}
			}
			payload = map[string]any{
				"exists":      len(identifiers),
				"identifiers": identifiers,
			}
		}
	case http.MethodDelete:
		var input map[string]any
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil && !errors.Is(decodeErr, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		
		nameStr := ""
		if val, ok := input["name"].(string); ok {
			nameStr = val
		}
		name := strings.ToUpper(strings.TrimSpace(nameStr))

		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Name is required"})
			return
		}
		
		err = h.Store.Delete(r.Context(), sessionKey, slug, name)
		statusCode = http.StatusNoContent
	default:
		w.Header().Set("Allow", "GET, DELETE")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		case errors.Is(err, ErrInUse):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Cannot delete an identifier of an existing project"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project identifier storage is unavailable"})
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
