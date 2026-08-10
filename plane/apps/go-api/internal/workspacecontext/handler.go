package workspacecontext

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type Store interface {
	CurrentMember(context.Context, string, string) (map[string]any, error)
	RecentVisits(context.Context, string, string, string) ([]map[string]any, error)
	SidebarPreferences(context.Context, string, string) (map[string]Preference, error)
	PatchSidebarPreferences(context.Context, string, string, []PreferencePatch) error
	UserProperties(context.Context, string, string) (map[string]any, error)
	PatchUserProperties(context.Context, string, string, map[string]any) (map[string]any, error)
}

type Mode uint8

const (
	ModeCurrentMember Mode = iota
	ModeRecentVisits
	ModeSidebarPreferences
	ModeUserProperties
)

type Handler struct {
	Store             Store
	SessionCookieName string
	Mode              Mode
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace context storage is unavailable"})
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
	switch h.Mode {
	case ModeCurrentMember:
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		payload, err = h.Store.CurrentMember(r.Context(), sessionKey, slug)
	case ModeRecentVisits:
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		payload, err = h.Store.RecentVisits(r.Context(), sessionKey, slug, r.URL.Query().Get("entity_name"))
	case ModeSidebarPreferences:
		switch r.Method {
		case http.MethodGet:
			payload, err = h.Store.SidebarPreferences(r.Context(), sessionKey, slug)
		case http.MethodPatch:
			var patches []PreferencePatch
			if key := r.PathValue("preference_key"); key != "" {
				var patch PreferencePatch
				if decodeJSON(r, &patch) != nil {
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The payload is not valid"})
					return
				}
				patch.Key = key
				patches = []PreferencePatch{patch}
			} else if decodeJSON(r, &patches) != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The payload is not valid"})
				return
			}
			err = h.Store.PatchSidebarPreferences(r.Context(), sessionKey, slug, patches)
			payload = map[string]string{"message": "Successfully updated"}
		default:
			methodNotAllowed(w, http.MethodGet, http.MethodPatch)
			return
		}
	case ModeUserProperties:
		switch r.Method {
		case http.MethodGet:
			payload, err = h.Store.UserProperties(r.Context(), sessionKey, slug)
		case http.MethodPatch:
			var patch map[string]any
			if decodeJSON(r, &patch) != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The payload is not valid"})
				return
			}
			payload, err = h.Store.PatchUserProperties(r.Context(), sessionKey, slug, patch)
		default:
			methodNotAllowed(w, http.MethodGet, http.MethodPatch)
			return
		}
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "route not found"})
		return
	}

	if err != nil {
		writeStoreError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

func decodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "The required object does not exist."})
	case errors.Is(err, ErrInvalidPayload):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The payload is not valid"})
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace context storage is unavailable"})
	}
}

func methodNotAllowed(w http.ResponseWriter, methods ...string) {
	for _, method := range methods {
		w.Header().Add("Allow", method)
	}
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
