package favorite

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
)

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil || !h.Store.Available() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "favorite storage is unavailable"})
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
	favoriteID := r.PathValue("favorite_id")

	var payload any
	var err error
	statusCode := http.StatusOK

	path := r.URL.Path
	if strings.HasSuffix(path, "/group") || strings.HasSuffix(path, "/group/") {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if favoriteID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "favorite id required"})
			return
		}
		payload, err = h.Store.ListGroupForSession(r.Context(), sessionKey, slug, favoriteID)
	} else {
		switch r.Method {
		case http.MethodGet:
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug)
		case http.MethodPost:
			var input WritePayload
			decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
			if decodeErr := decoder.Decode(&input); decodeErr != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
				return
			}
			payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, input)
		case http.MethodPatch:
			if favoriteID == "" {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "favorite id required"})
				return
			}
			var input WritePayload
			decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
			if decodeErr := decoder.Decode(&input); decodeErr != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
				return
			}
			payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, favoriteID, input)
		case http.MethodDelete:
			if favoriteID == "" {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "favorite id required"})
				return
			}
			err = h.Store.DeleteForSession(r.Context(), sessionKey, slug, favoriteID)
			statusCode = http.StatusNoContent
		default:
			w.Header().Set("Allow", "GET, POST, PATCH, DELETE")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
	}

	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Favorite does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			log.Printf("[FAVORITE HANDLER ERROR] %v", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "favorite storage is unavailable"})
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

type ProjectFavoriteHandler struct {
	Store             Store
	SessionCookieName string
	EntityType        string
}

func (h ProjectFavoriteHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil || !h.Store.Available() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "favorite storage is unavailable"})
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
	favoriteID := r.PathValue(h.EntityType + "_id") // e.g. cycle_id, module_id, view_id

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		payload, err = h.Store.ListProjectFavoritesForSession(r.Context(), sessionKey, slug, projectID, h.EntityType)
	case http.MethodPost:
		var input map[string]any
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}

		entityIdentifier, ok := input[h.EntityType].(string)
		if !ok || entityIdentifier == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Entity identifier required."})
			return
		}

		err = h.Store.CreateProjectFavoriteForSession(r.Context(), sessionKey, slug, projectID, h.EntityType, entityIdentifier)
		statusCode = http.StatusNoContent
	case http.MethodDelete:
		if favoriteID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "favorite id required"})
			return
		}
		err = h.Store.DeleteProjectFavoriteForSession(r.Context(), sessionKey, slug, projectID, h.EntityType, favoriteID)
		statusCode = http.StatusNoContent
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Favorite does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "favorite storage is unavailable"})
		}
		return
	}

	if statusCode == http.StatusNoContent {
		w.WriteHeader(statusCode)
		return
	}
	writeJSON(w, statusCode, payload)
}

type WorkspaceProjectFavoriteHandler struct {
	Store             Store
	SessionCookieName string
}

func (h WorkspaceProjectFavoriteHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil || !h.Store.Available() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "favorite storage is unavailable"})
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
	projectID := r.PathValue("project_id") // for DELETE /user-favorite-projects/{project_id}/

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		payload, err = h.Store.ListWorkspaceFavoritesForSession(r.Context(), sessionKey, slug, "project")
	case http.MethodPost:
		var input struct {
			Project string `json:"project"`
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil || input.Project == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload. Project ID required."})
			return
		}
		err = h.Store.CreateProjectFavoriteForSession(r.Context(), sessionKey, slug, input.Project, "project", input.Project)
		statusCode = http.StatusNoContent
	case http.MethodDelete:
		if projectID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "project id required"})
			return
		}
		err = h.Store.DeleteProjectFavoriteForSession(r.Context(), sessionKey, slug, projectID, "project", projectID)
		statusCode = http.StatusNoContent
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Favorite does not exist"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "favorite storage is unavailable"})
		}
		return
	}

	if statusCode == http.StatusNoContent {
		w.WriteHeader(statusCode)
		return
	}
	writeJSON(w, statusCode, payload)
}

