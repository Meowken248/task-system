package tracking

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

type Store interface {
	List(context.Context, string, string, string) ([]map[string]any, error)
	RecordOffline(context.Context, string, string, string, map[string]any) (map[string]any, error)
	RecordVerified(context.Context, string, string, string, map[string]any) (map[string]any, error)
}

type Verifier interface {
	Verify(context.Context, map[string]any) (map[string]any, error)
}

type Handler struct {
	Store             Store
	Verifier          Verifier
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	slug, projectID := r.PathValue("slug"), r.PathValue("project_id")
	switch r.Method {
	case http.MethodGet:
		h.get(w, r, slug, projectID)
	case http.MethodPost:
		h.post(w, r, slug, projectID)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (h Handler) get(w http.ResponseWriter, r *http.Request, slug, projectID string) {
	if h.Store == nil {
		writeError(w, http.StatusServiceUnavailable, "tracking storage is unavailable")
		return
	}
	records, err := h.Store.List(r.Context(), slug, projectID, r.URL.Query().Get("assignee_id"))
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeError(w, http.StatusUnauthorized, err.Error())
		case errors.Is(err, ErrForbidden):
			writeError(w, http.StatusForbidden, err.Error())
		default:
			writeError(w, http.StatusServiceUnavailable, "tracking storage is unavailable")
		}
		return
	}
	writeJSON(w, http.StatusOK, records)
}

func (h Handler) post(w http.ResponseWriter, r *http.Request, slug, projectID string) {
	var payload map[string]any
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON payload")
		return
	}
	eventType, _ := payload["event_type"].(string)
	onChain, hasOnChain := payload["on_chain"].(bool)
	isOffline := hasOnChain && !onChain && (eventType == "create_task" || eventType == "daily_report")
	if h.Store == nil {
		writeError(w, http.StatusServiceUnavailable, "tracking storage is unavailable")
		return
	}
	if isOffline && (empty(payload["issue_id"]) || empty(payload["client_event_id"])) {
		writeError(w, http.StatusBadRequest, "issue_id and client_event_id are required")
		return
	}
	if eventType == "daily_report" && payload["progress"] == nil {
		writeError(w, http.StatusBadRequest, "progress is required")
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
	var record map[string]any
	var err error
	if isOffline {
		record, err = h.Store.RecordOffline(r.Context(), sessionKey, slug, projectID, payload)
	} else if h.Verifier != nil {
		if empty(payload["issue_id"]) || empty(payload["transaction_hash"]) || empty(payload["event_type"]) {
			writeError(w, http.StatusBadRequest, "issue_id, event_type and transaction_hash are required")
			return
		}
		metadata, verifyErr := h.Verifier.Verify(r.Context(), payload)
		if verifyErr != nil {
			status := http.StatusServiceUnavailable
			if typed, ok := verifyErr.(interface{ HTTPStatus() int }); ok {
				status = typed.HTTPStatus()
			}
			writeError(w, status, verifyErr.Error())
			return
		}
		for key, value := range metadata {
			payload[key] = value
		}
		record, err = h.Store.RecordVerified(r.Context(), sessionKey, slug, projectID, payload)

	} else {
		writeError(w, http.StatusNotImplemented, "on-chain verification has not been migrated")
		return
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeError(w, http.StatusUnauthorized, err.Error())
		case errors.Is(err, ErrForbidden):
			writeError(w, http.StatusForbidden, err.Error())
		case errors.Is(err, ErrInvalidProgress):
			writeError(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrConflict):
			writeError(w, http.StatusConflict, err.Error())
		default:
			writeError(w, http.StatusServiceUnavailable, "tracking persistence failed")
		}
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func empty(value any) bool {
	return value == nil || fmt.Sprint(value) == ""
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
