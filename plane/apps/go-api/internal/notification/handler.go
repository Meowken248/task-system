package notification

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "notification store unavailable"})
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

	switch {
	case r.Method == http.MethodGet && tail == "unread":
		total, mentions, storeErr := h.Store.UnreadCounts(r.Context(), cookie.Value, slug)
		if storeErr != nil {
			writeStoreError(w, storeErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{
			"total_unread_notifications_count":   total,
			"mention_unread_notifications_count": mentions,
		})
	case r.Method == http.MethodGet && tail == "":
		items, total, storeErr := h.Store.ListForSession(r.Context(), cookie.Value, slug, options)
		if storeErr != nil {
			writeStoreError(w, storeErr)
			return
		}
		if r.URL.Query().Has("per_page") || r.URL.Query().Has("cursor") {
			writeJSON(w, http.StatusOK, map[string]any{
				"next_cursor": nil, "prev_cursor": nil,
				"next_page_results": false, "prev_page_results": false,
				"total_pages": 1, "extra_stats": nil,
				"count": len(items), "total_count": total, "results": items,
				"grouped_by": nil, "sub_grouped_by": nil,
			})
			return
		}
		writeJSON(w, http.StatusOK, items)
	case r.Method == http.MethodPost && tail == "mark-all-read":
		updated, storeErr := h.Store.MarkAllReadForSession(r.Context(), cookie.Value, slug, options)
		if storeErr != nil {
			writeStoreError(w, storeErr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"message": "Successful", "updated": updated})
	default:
		h.handleNotificationMutation(w, r, cookie.Value, slug, tail)
	}
}

func (h Handler) handleNotificationMutation(w http.ResponseWriter, r *http.Request, sessionKey, slug, tail string) {
	parts := strings.Split(tail, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	id := parts[0]
	var item Notification
	var err error
	switch {
	case r.Method == http.MethodPatch && len(parts) == 1:
		var payload struct {
			SnoozedTill *string `json:"snoozed_till"`
		}
		if decodeErr := json.NewDecoder(r.Body).Decode(&payload); decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		var snoozed *time.Time
		if payload.SnoozedTill != nil && strings.TrimSpace(*payload.SnoozedTill) != "" {
			parsed, parseErr := time.Parse(time.RFC3339, *payload.SnoozedTill)
			if parseErr != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "snoozed_till must be RFC3339"})
				return
			}
			snoozed = &parsed
		}
		item, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, id, snoozed)
	case len(parts) == 2 && parts[1] == "read" && r.Method == http.MethodPost:
		item, err = h.Store.SetReadForSession(r.Context(), sessionKey, slug, id, true)
	case len(parts) == 2 && parts[1] == "read" && r.Method == http.MethodDelete:
		item, err = h.Store.SetReadForSession(r.Context(), sessionKey, slug, id, false)
	case len(parts) == 2 && parts[1] == "archive" && r.Method == http.MethodPost:
		item, err = h.Store.SetArchivedForSession(r.Context(), sessionKey, slug, id, true)
	case len(parts) == 2 && parts[1] == "archive" && r.Method == http.MethodDelete:
		item, err = h.Store.SetArchivedForSession(r.Context(), sessionKey, slug, id, false)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func parseOptions(r *http.Request) ListOptions {
	query := r.URL.Query()
	options := ListOptions{
		Archived:  parseBool(query.Get("archived")),
		Snoozed:   parseBool(query.Get("snoozed")),
		Mentioned: parseBool(query.Get("mentioned")),
	}
	if value := query.Get("read"); value != "" {
		parsed := parseBool(value)
		options.Read = &parsed
	}
	if value, err := strconv.Atoi(query.Get("per_page")); err == nil {
		options.Limit = value
	}
	return options
}

func parseBool(value string) bool {
	value = strings.TrimSpace(strings.ToLower(value))
	return value == "true" || value == "1" || value == "yes"
}

func writeStoreError(w http.ResponseWriter, err error) {
	fmt.Println("STORE ERROR:", err)
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "workspace access denied"})
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "notification not found"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "notification operation failed"})
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
