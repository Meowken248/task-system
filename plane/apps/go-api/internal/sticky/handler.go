package sticky

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type Store interface {
	ListForSession(context.Context, string, string, ListOptions) (Page, error)
	CreateForSession(context.Context, string, string, WritePayload) (Item, error)
	GetForSession(context.Context, string, string, string) (Item, error)
	UpdateForSession(context.Context, string, string, string, WritePayload) (Item, error)
	DeleteForSession(context.Context, string, string, string) error
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "sticky storage is unavailable"})
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
	stickyID := r.PathValue("sticky_id")

	var (
		payload any
		err     error
		status  = http.StatusOK
	)
	switch r.Method {
	case http.MethodGet:
		if stickyID == "" {
			options, parseErr := parseListOptions(r.URL.Query())
			if parseErr != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detail": parseErr.Error()})
				return
			}
			payload, err = h.Store.ListForSession(r.Context(), sessionKey, slug, options)
		} else {
			payload, err = h.Store.GetForSession(r.Context(), sessionKey, slug, stickyID)
		}
	case http.MethodPost:
		if stickyID != "" {
			w.Header().Set("Allow", "GET, PATCH, DELETE")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed."})
			return
		}
		input, decodeErr := decodePayload(r)
		if decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "JSON parse error."})
			return
		}
		payload, err = h.Store.CreateForSession(r.Context(), sessionKey, slug, input)
		status = http.StatusCreated
	case http.MethodPatch:
		if stickyID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found."})
			return
		}
		input, decodeErr := decodePayload(r)
		if decodeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "JSON parse error."})
			return
		}
		payload, err = h.Store.UpdateForSession(r.Context(), sessionKey, slug, stickyID, input)
	case http.MethodDelete:
		if stickyID == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found."})
			return
		}
		err = h.Store.DeleteForSession(r.Context(), sessionKey, slug, stickyID)
		status = http.StatusNoContent
	default:
		w.Header().Set("Allow", "GET, POST, PATCH, DELETE")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed."})
		return
	}

	if err != nil {
		switch {
		case errors.Is(err, ErrUnauthorized):
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		case errors.Is(err, ErrForbidden):
			writeJSON(w, http.StatusForbidden, map[string]string{"detail": "You do not have permission to perform this action."})
		case errors.Is(err, ErrNotFound):
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "No Sticky matches the given query."})
		case errors.Is(err, ErrInvalidHTML):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "html content is not valid"})
		case errors.Is(err, ErrInvalidBinary):
			writeJSON(w, http.StatusBadRequest, map[string]string{"description_binary": "Invalid binary data"})
		case errors.Is(err, ErrInvalid):
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		default:
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "sticky storage is unavailable"})
		}
		return
	}
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	writeJSON(w, status, payload)
}

func decodePayload(r *http.Request) (WritePayload, error) {
	var input WritePayload
	err := json.NewDecoder(io.LimitReader(r.Body, 11<<20)).Decode(&input)
	return input, err
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
