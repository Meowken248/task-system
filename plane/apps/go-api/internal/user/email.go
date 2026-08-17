package user

import (
	"net/http"
)

type EmailHandler struct {
	SessionCookieName string
}

func (h EmailHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}

	if r.Method == http.MethodPost { // POST /api/users/me/email/generate-code/
		// Mock implementation
		writeJSON(w, http.StatusOK, map[string]string{"message": "Verification code generated"})
		return
	}
	
	if r.Method == http.MethodPatch { // PATCH /api/users/me/email/
		// Mock implementation
		writeJSON(w, http.StatusOK, map[string]string{"message": "Email updated successfully"})
		return
	}
	
	w.WriteHeader(http.StatusMethodNotAllowed)
}
