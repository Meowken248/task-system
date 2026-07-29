package archive

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

type Handler struct {
	Store             PostgreSQLStore
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "archive storage is unavailable"})
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

	var payload any
	var err error
	statusCode := http.StatusOK

	path := r.URL.Path
	if strings.HasSuffix(path, "/bulk-archive-issues") || strings.HasSuffix(path, "/bulk-archive-issues/") {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var input struct {
			IssueIDs []string `json:"issue_ids"`
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid body."})
			return
		}
		var archivedAt time.Time
		archivedAt, err = h.Store.BulkArchive(r.Context(), sessionKey, slug, projectID, input.IssueIDs)
		payload = map[string]string{"archived_at": archivedAt.Format("2006-01-02")}
	} else {
		// Single archive/unarchive
		if issueID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "issue id required"})
			return
		}
		if strings.HasSuffix(path, "/archive") || strings.HasSuffix(path, "/archive/") {
			switch r.Method {
			case http.MethodPost:
				var archivedAt time.Time
				archivedAt, err = h.Store.Archive(r.Context(), sessionKey, slug, projectID, issueID)
				payload = map[string]string{"archived_at": archivedAt.Format("2006-01-02")}
			case http.MethodDelete:
				err = h.Store.Unarchive(r.Context(), sessionKey, slug, projectID, issueID)
				statusCode = http.StatusNoContent
			default:
				w.Header().Set("Allow", "POST, DELETE")
				writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
		} else {
			// Legacy list / retrieve fallback
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Issue does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Can only archive completed or cancelled state group issue"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "archive storage is unavailable"})
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
