package deployboard

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type ProjectDeployBoardHandler struct {
	Store             Store
	SessionCookieName string
}

func (h ProjectDeployBoardHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "deploy board storage is unavailable"})
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

	var board DeployBoard
	var err error

	switch r.Method {
	case http.MethodGet:
		board, err = h.Store.GetProjectDeployBoard(r.Context(), sessionKey, slug, projectID)
	case http.MethodPost:
		var payload map[string]any
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		if decodeErr := decoder.Decode(&payload); decodeErr != nil && !errors.Is(decodeErr, io.EOF) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The payload is not valid"})
			return
		}
		board, err = h.Store.SaveProjectDeployBoard(r.Context(), sessionKey, slug, projectID, payload)
	default:
		w.Header().Set("Allow", "GET, POST")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}

	if err != nil {
		if errors.Is(err, ErrForbidden) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Forbidden"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Something went wrong. Please try again later."})
		}
		return
	}

	if board.ID == "" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}

	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, board)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
