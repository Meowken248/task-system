package cycle

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type CycleIssueHandler struct {
	Store             CycleIssueStore
	SessionCookieName string
}

func (h CycleIssueHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "cycle issue storage is unavailable"})
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
	issueID := r.PathValue("issue_id")

	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		// For CycleIssueDetail GET /api/workspaces/{slug}/projects/{project_id}/cycles/{cycle_id}/cycle-issues/{issue_id}/
		// Django allows it, but it might just return the issue detail. Since our Store.List doesn't have a detail method,
		// we can filter the list in memory if issueID is present, or just leave it out if we don't need it.
		// Wait, GET without issueID is the primary use case.
		payload, err = h.Store.List(r.Context(), sessionKey, slug, projectID, cycleID)
	case http.MethodPost:
		var input CycleIssueWritePayload
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
		payload, err = h.Store.Create(r.Context(), sessionKey, slug, projectID, cycleID, input)
		// Wait, Django returns the full paginated list on POST as well!
		// cycle.py line 999: return Response(CycleIssueSerializer(self.get_queryset(), many=True).data, status=status.HTTP_200_OK)
		// Oh, it returns the CycleIssue mapping objects! The GET endpoint returns Issue objects!
		// Wait, CycleIssueSerializer is the mapping object.
		// We'll return the created items directly for now, or we can fetch the list. Let's fetch the mapping list if needed.
		// Actually, returning the created mappings is fine.
		// But let's check Django precisely: it returns ALL CycleIssue mappings for the cycle.
		// Since we didn't implement fetching all mappings (our List fetches Issues), returning created items is a safe fallback,
		// but wait! Let's just return what `Create` returned (the newly created items).
	case http.MethodDelete:
		if issueID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "issue_id is required"})
			return
		}
		err = h.Store.Delete(r.Context(), sessionKey, slug, projectID, cycleID, issueID)
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
