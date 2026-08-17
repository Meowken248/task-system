package projectmember

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type Store interface {
	ListForSession(context.Context, string, string, string) ([]Membership, error)
	BulkCreate(context.Context, string, string, string, []map[string]any) error
	UpdateRole(context.Context, string, string, string, string, int16) (Membership, error)
	Remove(context.Context, string, string, string, string) error
	Leave(ctx context.Context, sessionKey, slug, projectID string) error
	UpdateViewProps(ctx context.Context, sessionKey, slug, projectID string, payload map[string]any) error
}

type CurrentReader interface {
	GetForSession(context.Context, string, string, string) (Membership, error)
}

type WorkspaceReader interface {
	WorkspaceListForSession(context.Context, string, string) (map[string][]Membership, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
	Current           bool
	Leave             bool
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project member storage is unavailable"})
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	sessionKey := ""
	var err error
	if cookie, e := r.Cookie(cookieName); e == nil {
		sessionKey = cookie.Value
	}
	if h.Leave {
		err = h.Store.Leave(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	var payload any
	memberID := r.PathValue("member_id")

	switch r.Method {
	case http.MethodGet:
		if h.Current {
			currentStore, ok := h.Store.(CurrentReader)
			if !ok {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "current project member storage is unavailable"})
				return
			}
			payload, err = currentStore.GetForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"))
		} else {
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"))
		}
	case http.MethodPost:
		var body struct {
			Members []map[string]any `json:"members"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
		if decodeErr := decoder.Decode(&body); decodeErr != nil || len(body.Members) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
			return
		}
		err = h.Store.BulkCreate(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), body.Members)
		if err == nil {
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"))
		}
	case http.MethodPatch:
		var body struct {
			Role *int16 `json:"role"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
		if decodeErr := decoder.Decode(&body); decodeErr != nil || body.Role == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
			return
		}
		payload, err = h.Store.UpdateRole(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), memberID, *body.Role)
	case http.MethodDelete:
		err = h.Store.Remove(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), memberID)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=10")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
	default:
		// Convert standard error messages to Bad Request
		msg := err.Error()
		if len(msg) > 0 && msg[0] >= 'a' && msg[0] <= 'z' {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project member storage is unavailable"})
	}
}

type ProjectUserViewsHandler struct {
	Store             Store
	SessionCookieName string
}

func (h ProjectUserViewsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
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
	var payload map[string]any
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := decoder.Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The payload is not valid"})
		return
	}
	if err := h.Store.UpdateViewProps(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), payload); err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		} else if errors.Is(err, ErrForbidden) || err.Error() == "project member not found" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Forbidden"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Something went wrong. Please try again later."})
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type WorkspaceProjectMembersHandler struct {
	Store             WorkspaceReader
	SessionCookieName string
}

func (h WorkspaceProjectMembersHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project member storage is unavailable"})
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

	payload, err := h.Store.WorkspaceListForSession(r.Context(), sessionKey, r.PathValue("slug"))
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project member storage is unavailable"})
		}
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=10")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type UserProjectRolesStore interface {
	UserProjectRoles(ctx context.Context, sessionKey, slug string) (map[string]int16, error)
}

type UserProjectRolesHandler struct {
	Store             UserProjectRolesStore
	SessionCookieName string
}

func (h UserProjectRolesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project member storage is unavailable"})
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
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

	payload, err := h.Store.UserProjectRoles(r.Context(), sessionKey, r.PathValue("slug"))
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "project member storage is unavailable"})
		}
		return
	}

	w.Header().Set("Cache-Control", "private, max-age=10")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

