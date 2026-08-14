package cycle

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type Reader interface {
	ListForSession(context.Context, string, string, string) ([]CycleItem, error)
	GetProgressForSession(context.Context, string, string, string, string) (any, error)
	GetAnalyticsForSession(context.Context, string, string, string, string, string) (any, error)
	CreateForSession(context.Context, string, string, string, WritePayload) (CycleItem, error)
	UpdateForSession(context.Context, string, string, string, string, WritePayload) (CycleItem, error)
	DeleteForSession(context.Context, string, string, string, string) error
}

type Handler struct {
	Store             Reader
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "cycle storage is unavailable"})
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
	cycleID := r.PathValue("cycle_id")
	cycleAction := r.PathValue("cycle_action")

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		if cycleAction == "progress" {
			if cycleID == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cycle id required"})
				return
			}
			payload, err = h.Store.GetProgressForSession(r.Context(), sessionKey, slug, projectID, cycleID)
		} else if cycleAction == "analytics" {
			if cycleID == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cycle id required"})
				return
			}
			analyticType := r.URL.Query().Get("type")
			if analyticType == "" {
				analyticType = "issues"
			}
			payload, err = h.Store.GetAnalyticsForSession(r.Context(), sessionKey, slug, projectID, cycleID, analyticType)
		} else {
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, projectID)
		}
	case http.MethodPost:
		var input WritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, projectID, input)
		statusCode = http.StatusCreated
	case http.MethodPatch:
		if cycleID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "cycle id required"})
			return
		}
		var input WritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, projectID, cycleID, input)
	case http.MethodDelete:
		if cycleID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "cycle id required"})
			return
		}
		err = h.Store.DeleteForSession(r.Context(), sessionKey, slug, projectID, cycleID)
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Cycle does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "cycle storage is unavailable"})
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
