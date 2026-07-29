package search

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
	
	// GET /api/workspaces/{slug}/search/?search=query
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if r.Method == http.MethodGet && len(parts) >= 3 && parts[len(parts)-1] == "search" {
		workspaceSlug := parts[2]
		query := r.URL.Query().Get("search")
		if query == "" {
			query = r.URL.Query().Get("query")
		}
		
		results, err := h.Store.GlobalSearch(r.Context(), workspaceSlug, query)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		
		json.NewEncoder(w).Encode(map[string]any{
			"results": results,
		})
		return
	}
	
	w.WriteHeader(http.StatusMethodNotAllowed)
	json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
}
