package apitoken

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

type Store interface {
	List(context.Context, string) ([]Token, error)
	Create(context.Context, string, CreateInput) (Token, error)
	Retrieve(context.Context, string, string, bool) (Token, error)
	Update(context.Context, string, string, UpdateInput) (Token, error)
	Delete(context.Context, string, string) error
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

type requestPayload struct {
	Label            *string `json:"label"`
	Description      *string `json:"description"`
	ExpiredAt        *string `json:"expired_at"`
	IsService        *bool   `json:"is_service"`
	AllowedRateLimit *string `json:"allowed_rate_limit"`
	// Read-only serializer fields are intentionally accepted and ignored, as DRF does.
	ID        any `json:"id"`
	Token     any `json:"token"`
	CreatedAt any `json:"created_at"`
	UpdatedAt any `json:"updated_at"`
	Workspace any `json:"workspace"`
	User      any `json:"user"`
	IsActive  any `json:"is_active"`
	LastUsed  any `json:"last_used"`
	UserType  any `json:"user_type"`
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "API token storage is unavailable"})
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
	tokenID := r.PathValue("token_id")

	var payload any
	var err error
	status := http.StatusOK
	switch r.Method {
	case http.MethodGet:
		if tokenID == "" {
			payload, err = h.Store.List(r.Context(), sessionKey)
		} else {
			payload, err = h.Store.Retrieve(r.Context(), sessionKey, tokenID, false)
		}
	case http.MethodPost:
		if tokenID != "" {
			writeMethodNotAllowed(w, "GET, PATCH, DELETE")
			return
		}
		body, ok := decodePayload(w, r)
		if !ok {
			return
		}
		var expiredAt *time.Time
		if body.ExpiredAt != nil && strings.TrimSpace(*body.ExpiredAt) != "" {
			parsed, parseErr := time.Parse(time.RFC3339, *body.ExpiredAt)
			if parseErr != nil {
				writeJSON(w, http.StatusBadRequest, map[string][]string{"expired_at": {"Datetime has wrong format. Use ISO 8601."}})
				return
			}
			expiredAt = &parsed
		}
		payload, err = h.Store.Create(r.Context(), sessionKey, CreateInput{
			Label: body.Label, Description: body.Description, ExpiredAt: expiredAt,
		})
		status = http.StatusCreated
	case http.MethodPatch:
		if tokenID == "" {
			writeMethodNotAllowed(w, "GET, POST")
			return
		}
		body, ok := decodePayload(w, r)
		if !ok {
			return
		}
		payload, err = h.Store.Update(r.Context(), sessionKey, tokenID, UpdateInput{
			Label: body.Label, Description: body.Description, IsService: body.IsService,
			AllowedRateLimit: body.AllowedRateLimit,
		})
	case http.MethodDelete:
		if tokenID == "" {
			writeMethodNotAllowed(w, "GET, POST")
			return
		}
		err = h.Store.Delete(r.Context(), sessionKey, tokenID)
		status = http.StatusNoContent
	default:
		if tokenID == "" {
			writeMethodNotAllowed(w, "GET, POST")
		} else {
			writeMethodNotAllowed(w, "GET, PATCH, DELETE")
		}
		return
	}

	if err != nil {
		writeStoreError(w, err)
		return
	}
	if status == http.StatusNoContent {
		w.WriteHeader(status)
		return
	}
	writeJSON(w, status, payload)
}

func decodePayload(w http.ResponseWriter, r *http.Request) (requestPayload, bool) {
	var body requestPayload
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := decoder.Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request payload"})
		return requestPayload{}, false
	}
	return body, true
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "The required object does not exist."})
	case errors.Is(err, ErrInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": strings.TrimPrefix(err.Error(), ErrInvalid.Error()+": ")})
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "API token storage is unavailable"})
	}
}

func writeMethodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
