package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

type Reader interface {
	ListForSession(context.Context, string, []string) ([]map[string]any, error)
	Create(context.Context, string, WorkspacePayload) (map[string]any, error)
	Update(context.Context, string, string, map[string]any) (map[string]any, error)
	Delete(context.Context, string, string) error
}

type Handler struct {
	Store             Reader
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace storage is unavailable"})
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
		results, listErr := h.Store.ListForSession(r.Context(), sessionKey, splitFields(r.URL.Query().Get("fields")))
		err = listErr
		if err == nil {
			if results == nil {
				results = []map[string]any{}
			}
			
			// /api/users/me/workspaces/ should return a plain array,
			// while other endpoints (e.g. /api/workspaces/) expect paginated response
			if r.URL.Path == "/api/users/me/workspaces/" {
				payload = results
			} else {
				payload = map[string]any{
					"grouped_by":        nil,
					"sub_grouped_by":    nil,
					"total_count":       len(results),
					"next_cursor":       "1000:0:0",
					"prev_cursor":       "1000:0:0",
					"next_page_results": false,
					"prev_page_results": false,
					"count":             len(results),
					"total_pages":       1,
					"extra_stats":       nil,
					"results":           results,
				}
			}
		}
	case http.MethodPost:
		var input WorkspacePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid workspace payload."})
			return
		}
		payload, err = h.Store.Create(r.Context(), sessionKey, input)
		statusCode = http.StatusCreated
	case http.MethodPatch:
		if slug == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace slug required"})
			return
		}
		var input map[string]any
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.Update(r.Context(), sessionKey, slug, input)
	case http.MethodDelete:
		if slug == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace slug required"})
			return
		}
		err = h.Store.Delete(r.Context(), sessionKey, slug)
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Workspace does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace storage is unavailable"})
		}
		return
	}

	if statusCode == http.StatusNoContent {
		w.WriteHeader(statusCode)
		return
	}
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

type SlugCheckStore interface {
	CheckWorkspaceSlug(context.Context, string) (bool, error)
}

type SlugCheckHandler struct {
	Store SlugCheckStore
}

func (h SlugCheckHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	slug := r.URL.Query().Get("slug")
	if slug == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Workspace Slug is required"})
		return
	}
	exists, err := h.Store.CheckWorkspaceSlug(r.Context(), slug)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	// simplified RESTRICTED_WORKSPACE_SLUGS check
	if slug == "api" || slug == "admin" || slug == "god-mode" {
		exists = true
	}
	writeJSON(w, http.StatusOK, map[string]bool{"status": !exists})
}
