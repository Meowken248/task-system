package search

import (
	"encoding/json"
	"net/http"
)

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "search storage is unavailable"})
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie.Value == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}
	query := r.URL.Query().Get("search")
	if query == "" {
		query = r.URL.Query().Get("query")
	}
	results, err := h.Store.GlobalSearch(r.Context(), cookie.Value, r.PathValue("slug"), query)
	if err != nil {
		switch err {
		case ErrUnauthorized:
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case ErrForbidden:
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "search storage is unavailable"})
		}
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
