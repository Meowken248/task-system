package draftissue

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/makeplane/plane/apps/go-api/internal/issue"
)

type Store interface {
	ListForSession(ctx context.Context, sessionKey, slug string, filter Filter) (Page, error)
	GetForSession(ctx context.Context, sessionKey, slug, draftID string) (Item, error)
	CreateForSession(ctx context.Context, sessionKey, slug string, input WritePayload) (Item, error)
	UpdateForSession(ctx context.Context, sessionKey, slug, draftID string, input WritePayload) (Item, error)
	DeleteForSession(ctx context.Context, sessionKey, slug, draftID string) error
	DraftToIssue(ctx context.Context, sessionKey, slug, draftID string, payload issue.WritePayload) (issue.Item, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "draft issue store unavailable"})
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
		return
	}
	slug := r.PathValue("slug")
	tail := strings.Trim(r.PathValue("tail"), "/")
	options := parseOptions(r)

	// Route: draft-to-issue
	if strings.HasPrefix(r.URL.Path, "/api/workspaces/"+slug+"/draft-to-issue/") {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		parts := strings.Split(tail, "/")
		if len(parts) == 0 || parts[0] == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		draftID := parts[0]
		h.handleDraftToIssue(w, r, cookie.Value, slug, draftID)
		return
	}

	// Route: draft-issues
	switch {
	case r.Method == http.MethodGet && tail == "":
		page, err := h.Store.ListForSession(r.Context(), cookie.Value, slug, options)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, page)
	case r.Method == http.MethodPost && tail == "":
		var payload WritePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		item, err := h.Store.CreateForSession(r.Context(), cookie.Value, slug, payload)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, item)
	default:
		h.handleDraftMutation(w, r, cookie.Value, slug, tail)
	}
}

func (h Handler) handleDraftMutation(w http.ResponseWriter, r *http.Request, sessionKey, slug, tail string) {
	parts := strings.Split(tail, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	id := parts[0]
	switch r.Method {
	case http.MethodGet:
		item, err := h.Store.GetForSession(r.Context(), sessionKey, slug, id)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	case http.MethodPatch:
		var payload WritePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		item, err := h.Store.UpdateForSession(r.Context(), sessionKey, slug, id, payload)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, item)
	case http.MethodDelete:
		err := h.Store.DeleteForSession(r.Context(), sessionKey, slug, id)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusNoContent, nil)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	}
}

func (h Handler) handleDraftToIssue(w http.ResponseWriter, r *http.Request, sessionKey, slug, draftID string) {
	var payload issue.WritePayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	createdIssue, err := h.Store.DraftToIssue(r.Context(), sessionKey, slug, draftID, payload)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, createdIssue)
}

func parseOptions(r *http.Request) Filter {
	var f Filter
	limit, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	f.Limit = limit
	cursor := r.URL.Query().Get("cursor")
	if cursor != "" {
		parts := strings.Split(cursor, ",")
		if len(parts) > 0 {
			f.Offset, _ = strconv.Atoi(parts[0])
		}
	}
	return f
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		json.NewEncoder(w).Encode(data)
	}
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "access denied"})
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	case errors.Is(err, ErrInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrConflict):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}
