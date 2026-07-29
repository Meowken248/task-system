package notification

import (
	"encoding/json"
	"net/http"
	"strings"
)

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	// Ensure user is authenticated
	userID := r.Header.Get("X-User-ID")
	workspaceID := r.Header.Get("X-Workspace-ID")
	if userID == "" || workspaceID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
		return
	}

	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	
	// GET /api/users/me/notifications/
	if r.Method == http.MethodGet && len(parts) > 0 && parts[len(parts)-1] == "notifications" {
		notifications, err := h.Store.ListNotifications(r.Context(), userID, workspaceID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{
			"results": notifications,
			"count":   len(notifications),
		})
		return
	}

	// POST /api/users/me/notifications/{id}/read/
	if r.Method == http.MethodPost && len(parts) >= 2 && parts[len(parts)-1] == "read" {
		notificationID := parts[len(parts)-2]
		err := h.Store.MarkAsRead(r.Context(), userID, notificationID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	
	w.WriteHeader(http.StatusMethodNotAllowed)
	json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
}
