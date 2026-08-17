package projectinvite

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type Store interface {
	ListForSession(ctx context.Context, sessionKey, slug string) ([]Invitation, error)
	BulkJoin(ctx context.Context, sessionKey, slug string, projectIDs []string) error
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project invitation storage is unavailable"})
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

	switch r.Method {
	case http.MethodGet:
		invitations, err := h.Store.ListForSession(r.Context(), sessionKey, slug)
		if err != nil {
			h.writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, invitations)

	case http.MethodPost:
		var body struct {
			ProjectIDs []string `json:"project_ids"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
		if err := decoder.Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
			return
		}

		if err := h.Store.BulkJoin(r.Context(), sessionKey, slug, body.ProjectIDs); err != nil {
			h.writeError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]string{"message": "Projects joined successfully"})

	default:
		w.Header().Set("Allow", "GET, POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
	}
}

func (h Handler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
