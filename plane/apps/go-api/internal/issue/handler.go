package issue

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type Reader interface {
	ListForSession(context.Context, string, string, string, IssueFilter) (Page, error)
	GetForSession(context.Context, string, string, string, string) (Item, error)
}

type Writer interface {
	CreateForSession(context.Context, string, string, string, WritePayload) (Item, error)
	UpdateForSession(context.Context, string, string, string, string, WritePayload) (Item, error)
	DeleteForSession(context.Context, string, string, string, string) error
}

type Handler struct {
	Store             Reader
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work item storage is unavailable"})
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
	slug, projectID, issueID := r.PathValue("slug"), r.PathValue("project_id"), r.PathValue("issue_id")
	var payload any
	var err error
	statusCode := http.StatusOK

	switch r.Method {
	case http.MethodGet:
		if issueID != "" {
			payload, err = h.Store.GetForSession(r.Context(), sessionKey, slug, projectID, issueID)
			break
		}
		limit, offset, parseErr := parseCursor(r.URL.Query().Get("cursor"), r.URL.Query().Get("per_page"))
		if parseErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid cursor parameter."})
			return
		}
		
		filter := IssueFilter{
			Limit: limit, Offset: offset,
			State: r.URL.Query().Get("state"),
			StateGroup: r.URL.Query().Get("state_group"),
			Priority: r.URL.Query().Get("priority"),
			Labels: r.URL.Query().Get("labels"),
			Assignees: r.URL.Query().Get("assignees"),
			CreatedBy: r.URL.Query().Get("created_by"),
			OrderBy: r.URL.Query().Get("order_by"),
			GroupBy: r.URL.Query().Get("group_by"),
			SubGroupBy: r.URL.Query().Get("sub_group_by"),
		}
		
		payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, projectID, filter)
	case http.MethodPost, http.MethodPatch, http.MethodDelete:
		writer, ok := h.Store.(Writer)
		if !ok {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work item writes are unavailable"})
			return
		}
		if r.Method == http.MethodDelete {
			err = writer.DeleteForSession(r.Context(), sessionKey, slug, projectID, issueID)
			statusCode = http.StatusNoContent
			break
		}
		var input WritePayload
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&input); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid work item payload."})
			return
		}
		if r.Method == http.MethodPost {
			payload, err = writer.CreateForSession(r.Context(), sessionKey, slug, projectID, input)
			statusCode = http.StatusCreated
		} else {
			payload, err = writer.UpdateForSession(r.Context(), sessionKey, slug, projectID, issueID, input)
		}
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Work item does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		case errors.Is(err, ErrConflict):
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work item storage is unavailable"})
		}
		return
	}
	if statusCode == http.StatusNoContent {
		w.WriteHeader(statusCode)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=5")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, statusCode, payload)
}

func parseCursor(cursor, perPage string) (int, int, error) {
	limit := 1000
	if perPage != "" {
		value, err := strconv.Atoi(perPage)
		if err != nil || value < 1 {
			return 0, 0, errors.New("invalid per page")
		}
		limit = value
	}
	if limit > 1000 {
		limit = 1000
	}
	offset := 0
	if cursor != "" {
		parts := strings.Split(cursor, ":")
		if len(parts) < 2 {
			return 0, 0, errors.New("invalid cursor")
		}
		value, err := strconv.Atoi(parts[1])
		if err != nil || value < 0 {
			return 0, 0, errors.New("invalid cursor")
		}
		offset = value
	}
	return limit, offset, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
