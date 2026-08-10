package userproperty

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type Scope string

const (
	ScopeProject Scope = "project"
	ScopeCycle   Scope = "cycle"
	ScopeModule  Scope = "module"
)

type Store interface {
	GetForSession(context.Context, string, string, string, Scope, string) (map[string]any, error)
	PatchForSession(context.Context, string, string, string, Scope, string, map[string]any) (map[string]any, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
	Scope             Scope
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user properties storage is unavailable"})
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
	entityID := ""
	if h.Scope == ScopeCycle {
		entityID = r.PathValue("cycle_id")
	} else if h.Scope == ScopeModule {
		entityID = r.PathValue("module_id")
	}

	var payload map[string]any
	var err error
	switch r.Method {
	case http.MethodGet:
		payload, err = h.Store.GetForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), h.Scope, entityID)
	case http.MethodPatch:
		var patch map[string]any
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&patch); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The payload is not valid"})
			return
		}
		payload, err = h.Store.PatchForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), h.Scope, entityID, patch)
	default:
		w.Header().Set("Allow", "GET, PATCH")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if err != nil {
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
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user properties storage is unavailable"})
		}
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Add("Vary", "Cookie")
	status := http.StatusOK
	// Django returns 201 for cycle/module property updates, while project
	// property updates return 200. Keep that public API contract unchanged.
	if r.Method == http.MethodPatch && h.Scope != ScopeProject {
		status = http.StatusCreated
	}
	writeJSON(w, status, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
