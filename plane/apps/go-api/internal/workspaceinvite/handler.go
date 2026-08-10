package workspaceinvite

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type InviteInput struct {
	Email string `json:"email"`
	Role  int16  `json:"role"`
}

type Store interface {
	List(context.Context, string, string) ([]map[string]any, error)
	Create(context.Context, string, string, []InviteInput) error
	Retrieve(context.Context, string, string, string) (map[string]any, error)
	Update(context.Context, string, string, string, int16) (map[string]any, error)
	Delete(context.Context, string, string, string) error
	PublicRetrieve(context.Context, string, string) (map[string]any, error)
	Join(context.Context, string, string, string, bool) (string, error)
	ListForUser(context.Context, string) ([]map[string]any, error)
	JoinForUser(context.Context, string, []string) error
}

type Mode uint8

const (
	ModeWorkspace Mode = iota
	ModeJoin
	ModeUser
)

type Handler struct {
	Store             Store
	SessionCookieName string
	Mode              Mode
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace invitation storage is unavailable"})
		return
	}
	sessionKey := ""
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "sessionid"
	}
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}

	switch h.Mode {
	case ModeJoin:
		h.serveJoin(w, r, sessionKey)
	case ModeUser:
		h.serveUser(w, r, sessionKey)
	default:
		h.serveWorkspace(w, r, sessionKey)
	}
}

func (h Handler) serveWorkspace(w http.ResponseWriter, r *http.Request, sessionKey string) {
	slug, invitationID := r.PathValue("slug"), r.PathValue("invitation_id")
	var payload any
	var err error
	switch r.Method {
	case http.MethodGet:
		if invitationID == "" {
			payload, err = h.Store.List(r.Context(), sessionKey, slug)
		} else {
			payload, err = h.Store.Retrieve(r.Context(), sessionKey, slug, invitationID)
		}
	case http.MethodPost:
		var body struct {
			Emails []InviteInput `json:"emails"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if len(body.Emails) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Emails are required"})
			return
		}
		err = h.Store.Create(r.Context(), sessionKey, slug, body.Emails)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]string{"message": "Emails sent successfully"})
			return
		}
	case http.MethodPatch:
		var body struct {
			Role *int16 `json:"role"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if body.Role == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
			return
		}
		payload, err = h.Store.Update(r.Context(), sessionKey, slug, invitationID, *body.Role)
	case http.MethodDelete:
		err = h.Store.Delete(r.Context(), sessionKey, slug, invitationID)
		if err == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (h Handler) serveJoin(w http.ResponseWriter, r *http.Request, sessionKey string) {
	slug, invitationID := r.PathValue("slug"), r.PathValue("invitation_id")
	if r.Method == http.MethodGet {
		payload, err := h.Store.PublicRetrieve(r.Context(), slug, invitationID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, payload)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Token    string `json:"token"`
		Accepted bool   `json:"accepted"`
	}
	if decodeJSON(w, r, &body) != nil {
		return
	}
	message, err := h.Store.Join(r.Context(), slug, invitationID, body.Token, body.Accepted)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": message})
}

func (h Handler) serveUser(w http.ResponseWriter, r *http.Request, sessionKey string) {
	if r.Method == http.MethodGet {
		payload, err := h.Store.ListForUser(r.Context(), sessionKey)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, payload)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Invitations []string `json:"invitations"`
	}
	if decodeJSON(w, r, &body) != nil {
		return
	}
	if err := h.Store.JoinForUser(r.Context(), sessionKey, body.Invitations); err != nil {
		writeStoreError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10))
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
		return err
	}
	return nil
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
	case errors.Is(err, ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission"})
	case errors.Is(err, ErrJoinForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "You do not have permission to join the workspace"})
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Workspace invitation not found"})
	case errors.Is(err, ErrEmailsRequired):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Emails are required"})
	case errors.Is(err, ErrHigherRole):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "You cannot invite a user with higher role"})
	case errors.Is(err, ErrAlreadyMember):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Some users are already member of workspace"})
	case errors.Is(err, ErrInvalidEmail):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
	case errors.Is(err, ErrInvalidRole):
		writeJSON(w, http.StatusBadRequest, map[string]string{"role": "Invalid role"})
	case errors.Is(err, ErrAlreadyResponded):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "You have already responded to the invitation request"})
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "workspace invitation storage is unavailable"})
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
