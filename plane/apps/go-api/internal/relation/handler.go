package relation

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type Handler struct {
	Store             PostgreSQLStore
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "relation storage is unavailable"})
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

	var payload any
	var err error
	statusCode := http.StatusOK

	if r.URL.Path != "" && (r.Method == http.MethodPost || r.Method == http.MethodGet) {
		// Dựa vào path hay logic router để nhận diện action remove-relation hoặc list/create
		if r.URL.Path != "" && (r.URL.Path[len(r.URL.Path)-16:] == "/remove-relation" || r.URL.Path[len(r.URL.Path)-17:] == "/remove-relation/") {
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", "POST")
				writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
			var input struct {
				RelatedIssue string `json:"related_issue"`
			}
			decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
			if decodeErr := decoder.Decode(&input); decodeErr != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid body."})
				return
			}
			err = h.Store.RemoveForSession(r.Context(), sessionKey, slug, projectID, issueID, input.RelatedIssue)
			statusCode = http.StatusNoContent
		} else {
			switch r.Method {
			case http.MethodGet:
				payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, projectID, issueID)
			case http.MethodPost:
				var input CreatePayload
				decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
				if decodeErr := decoder.Decode(&input); decodeErr != nil {
					writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid relation payload."})
					return
				}
				payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, projectID, issueID, input)
				statusCode = http.StatusCreated
			default:
				w.Header().Set("Allow", "GET, POST")
				writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
				return
			}
		}
	}

	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Relation does not exist"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "relation storage is unavailable"})
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
