package page

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type Store interface {
	List(context.Context, string, string, string) ([]Item, error)
	Summary(context.Context, string, string, string) (Summary, error)
	Create(context.Context, string, string, string, WritePayload) (Item, error)
	Get(context.Context, string, string, string, string) (Item, error)
	Update(context.Context, string, string, string, string, WritePayload) (Item, error)
	Action(context.Context, string, string, string, string, string, WritePayload) (any, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "page storage is unavailable"})
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	session := ""
	if cookie, cookieErr := r.Cookie(cookieName); cookieErr == nil {
		session = cookie.Value
	}
	slug, projectID, pageID := r.PathValue("slug"), r.PathValue("project_id"), r.PathValue("page_id")
	action := r.PathValue("page_action")
	var payload any
	var err error
	status := http.StatusOK

	if action == "summary" && r.Method == http.MethodGet {
		payload, err = h.Store.Summary(r.Context(), session, slug, projectID)
	} else if action != "" {
		input := WritePayload{}
		if r.Method == http.MethodPost || r.Method == http.MethodPatch {
			if decodeErr := json.NewDecoder(io.LimitReader(r.Body, 12<<20)).Decode(&input); decodeErr != nil && !errors.Is(decodeErr, io.EOF) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "JSON parse error."})
				return
			}
		}
		if action == "version" {
			versionID := r.PathValue("version_id")
			input.Parent = &versionID
		}
		payload, err = h.Store.Action(r.Context(), session, slug, projectID, pageID, action+":"+r.Method, input)
		if r.Method == http.MethodDelete || action == "lock" || action == "access" || action == "favorite" {
			status = http.StatusNoContent
		}
		if action == "duplicate" {
			status = http.StatusCreated
		}
	} else {
		switch r.Method {
		case http.MethodGet:
			if pageID == "" {
				payload, err = h.Store.List(r.Context(), session, slug, projectID)
			} else {
				payload, err = h.Store.Get(r.Context(), session, slug, projectID, pageID)
			}
		case http.MethodPost:
			var input WritePayload
			if json.NewDecoder(io.LimitReader(r.Body, 12<<20)).Decode(&input) != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "JSON parse error."})
				return
			}
			payload, err = h.Store.Create(r.Context(), session, slug, projectID, input)
			status = http.StatusCreated
		case http.MethodPatch:
			var input WritePayload
			if json.NewDecoder(io.LimitReader(r.Body, 12<<20)).Decode(&input) != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "JSON parse error."})
				return
			}
			payload, err = h.Store.Update(r.Context(), session, slug, projectID, pageID, input)
		case http.MethodDelete:
			payload, err = h.Store.Action(r.Context(), session, slug, projectID, pageID, "delete:DELETE", WritePayload{})
			status = http.StatusNoContent
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed."})
			return
		}
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"detail": "You do not have permission to perform this action."})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Page not found"})
		case errors.Is(err, ErrLocked):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Page is locked"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "page storage is unavailable"})
		}
		return
	}
	if err == nil && action == "description" && r.Method == http.MethodGet {
		binary, ok := payload.(BinaryPayload)
		if !ok {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "invalid page description"})
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(binary.Data)
		return
	}
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	writeJSON(w, status, payload)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
