package module

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type ModuleIssueHandler struct {
	Store             ModuleIssueStore
	SessionCookieName string
}

func (h ModuleIssueHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "module issue storage is unavailable"})
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
	moduleID := r.PathValue("module_id")
	issueID := r.PathValue("issue_id")

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		payload, err = h.Store.List(r.Context(), sessionKey, slug, projectID, moduleID)
	case http.MethodPost:
		var input ModuleIssueWritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid payload."})
			return
		}
		if len(input.Issues) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "Work items are required",
				"code":  "MISSING_WORK_ITEMS",
			})
			return
		}
		payload, err = h.Store.Create(r.Context(), sessionKey, slug, projectID, moduleID, input)
	case http.MethodDelete:
		if issueID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "issue_id is required"})
			return
		}
		err = h.Store.Delete(r.Context(), sessionKey, slug, projectID, moduleID, issueID)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "not logged in"})
			return
		}
		if errors.Is(err, ErrForbidden) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "access denied"})
			return
		}
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if payload == nil {
		payload = make([]map[string]any, 0)
	}
	writeJSON(w, statusCode, payload)
}
