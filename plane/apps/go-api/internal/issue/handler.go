package issue

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
)

type Reader interface {
	ListForSession(context.Context, string, string, string, int, int) (Page, error)
	GetForSession(context.Context, string, string, string, string) (Item, error)
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
	var payload any
	var err error
	if issueID := r.PathValue("issue_id"); issueID != "" {
		payload, err = h.Store.GetForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), issueID)
	} else {
		limit, offset, parseErr := parseCursor(r.URL.Query().Get("cursor"), r.URL.Query().Get("per_page"))
		if parseErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid cursor parameter."})
			return
		}
		payload, err = h.Store.ListForSession(r.Context(), sessionKey, r.PathValue("slug"), r.PathValue("project_id"), limit, offset)
	}
	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Work item does not exist"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "work item storage is unavailable"})
		}
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=5")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
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
