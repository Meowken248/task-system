package estimate

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
	
	userID := r.Header.Get("X-User-ID")
	workspaceID := r.Header.Get("X-Workspace-ID")
	if userID == "" || workspaceID == "" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
		return
	}

	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	
	// GET /api/workspaces/{slug}/projects/{project_id}/estimates/
	if r.Method == http.MethodGet && len(parts) > 0 && parts[len(parts)-1] == "estimates" {
		projectID := r.PathValue("project_id")
		if projectID == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "project_id missing"})
			return
		}
		
		estimates, err := h.Store.ListEstimates(r.Context(), projectID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		
		// Optional: We can fetch estimate points here too, but for simplicity, we just list estimates.
		
		json.NewEncoder(w).Encode(estimates)
		return
	}
	
	w.WriteHeader(http.StatusMethodNotAllowed)
	json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
}
