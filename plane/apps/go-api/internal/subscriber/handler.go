package subscriber

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type Handler struct {
	Store             PostgreSQLStore
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "subscriber storage is unavailable"})
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
	subscriberID := r.PathValue("subscriber_id")

	var payload any
	var err error
	statusCode := http.StatusOK

	// Check path actions (subscribe, unsubscribe, subscription_status)
	path := r.URL.Path
	if strings.HasSuffix(path, "/subscribe") || strings.HasSuffix(path, "/subscribe/") {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		payload, err = h.Store.Subscribe(r.Context(), sessionKey, slug, projectID, issueID)
		statusCode = http.StatusCreated
	} else if strings.HasSuffix(path, "/unsubscribe") || strings.HasSuffix(path, "/unsubscribe/") {
		if r.Method != http.MethodDelete {
			w.Header().Set("Allow", "DELETE")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		err = h.Store.Unsubscribe(r.Context(), sessionKey, slug, projectID, issueID)
		statusCode = http.StatusNoContent
	} else if strings.HasSuffix(path, "/subscription_status") || strings.HasSuffix(path, "/subscription_status/") {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var isSubscribed bool
		isSubscribed, err = h.Store.GetSubscriptionStatus(r.Context(), sessionKey, slug, projectID, issueID)
		payload = map[string]bool{"subscribed": isSubscribed}
	} else {
		// Default views/CRUD
		switch r.Method {
		case http.MethodGet:
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, projectID)
		case http.MethodDelete:
			if subscriberID == "" {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "subscriber id required"})
				return
			}
			err = h.Store.RemoveSubscriber(r.Context(), sessionKey, slug, projectID, issueID, subscriberID)
			statusCode = http.StatusNoContent
		default:
			w.Header().Set("Allow", "GET, DELETE")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
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
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Subscriber does not exist"})
		case errors.Is(err, ErrConflict):
			writeJSON(w, http.StatusBadRequest, map[string]string{"message": "User already subscribed to the issue."})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "subscriber storage is unavailable"})
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
