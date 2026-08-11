package workspacemember

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type Store interface {
	List(context.Context, string, string) ([]map[string]any, error)
	Retrieve(context.Context, string, string, string) (map[string]any, error)
	UpdateRole(context.Context, string, string, string, int16) (map[string]any, error)
	Remove(context.Context, string, string, string) error
	Leave(context.Context, string, string) error
	UpdateViewProps(context.Context, string, string, map[string]any) error
}

type Handler struct {
	Store             Store
	SessionCookieName string
	Leave             bool
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace member storage is unavailable"})
		return
	}
	sessionKey := ""
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}

	if h.Leave {
		h.writeErrorOrNoContent(w, h.Store.Leave(r.Context(), sessionKey, r.PathValue("slug")))
		return
	}

	memberID := r.PathValue("member_id")
	var payload any
	var err error
	switch r.Method {
	case http.MethodGet:
		if memberID == "" {
			payload, err = h.Store.List(r.Context(), sessionKey, r.PathValue("slug"))
		} else {
			payload, err = h.Store.Retrieve(r.Context(), sessionKey, r.PathValue("slug"), memberID)
		}
	case http.MethodPatch:
		var body struct {
			Role *int16 `json:"role"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
		decoder.DisallowUnknownFields()
		if decodeErr := decoder.Decode(&body); decodeErr != nil || body.Role == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
			return
		}
		payload, err = h.Store.UpdateRole(r.Context(), sessionKey, r.PathValue("slug"), memberID, *body.Role)
	case http.MethodDelete:
		h.writeErrorOrNoContent(w, h.Store.Remove(r.Context(), sessionKey, r.PathValue("slug"), memberID))
		return
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

func (h Handler) writeErrorOrNoContent(w http.ResponseWriter, err error) {
	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type ViewsHandler struct {
	Store             Store
	SessionCookieName string
}

func (h ViewsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace member storage is unavailable"})
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	sessionKey := ""
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}

	var body struct {
		ViewProps map[string]any `json:"view_props"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	if decodeErr := decoder.Decode(&body); decodeErr != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
		return
	}
	if body.ViewProps == nil {
		body.ViewProps = make(map[string]any)
	}

	err := h.Store.UpdateViewProps(r.Context(), sessionKey, r.PathValue("slug"), body.ViewProps)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Workspace member not found"})
	case errors.Is(err, ErrInvalidRole):
		writeJSON(w, http.StatusBadRequest, map[string]string{"role": "Invalid role"})
	case errors.Is(err, ErrCannotUpdateSelf):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "You cannot update your own role"})
	case errors.Is(err, ErrCannotRemoveSelf):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "You cannot remove yourself from the workspace. Please use leave workspace"})
	case errors.Is(err, ErrHigherRole):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "You cannot remove a user having role higher than you"})
	case errors.Is(err, ErrOnlyProjectAdmin):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "User is a part of some projects where they are the only admin, they should either leave that project or promote another user to admin."})
	case errors.Is(err, ErrLeavingOnlyProjectAdmin):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "You are a part of some projects where you are the only admin, you should either leave the project or promote another user to admin."})
	case errors.Is(err, ErrOnlyWorkspaceAdmin):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "You cannot leave the workspace as you are the only admin of the workspace you will have to either delete the workspace or promote another user to admin."})
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace member storage is unavailable"})
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
