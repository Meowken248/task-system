package subissue

import (
	"encoding/json"
	"errors"
	"net/http"
)

type Handler struct {
	Store             PostgreSQLStore
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "subissue storage is unavailable"})
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
	issueID := r.PathValue("issue_id")
	groupBy := r.URL.Query().Get("group_by")

	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", "GET, POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var payload any
	var err error
	var statusCode = http.StatusOK

	if r.Method == http.MethodGet {
		payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, projectID, issueID, groupBy)
	} else {
		var input SubIssuePayload
		if errDecode := json.NewDecoder(r.Body).Decode(&input); errDecode == nil && len(input.SubIssueIDs) > 0 {
			payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, projectID, issueID, input)
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Sub Issue IDs are required"})
			return
		}
	}

	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "subissue storage is unavailable"})
		}
		return
	}

	writeJSON(w, statusCode, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
