package user

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

var ErrUnauthorized = errors.New("authentication required")

type Reader interface {
	CurrentForSession(context.Context, string) (map[string]any, error)
}

type Store interface {
	Reader
	UpdateCurrentForSession(context.Context, string, map[string]any) (map[string]any, error)
}

type ProfileReader interface {
	ProfileForSession(context.Context, string) (map[string]any, error)
}

type ProfileStore interface {
	ProfileReader
	UpdateProfileForSession(context.Context, string, map[string]any) (map[string]any, error)
}

type NotificationPreferences struct {
	ID             string  `json:"id"`
	User           string  `json:"user"`
	Workspace      *string `json:"workspace"`
	Project        *string `json:"project"`
	PropertyChange bool    `json:"property_change"`
	StateChange    bool    `json:"state_change"`
	Comment        bool    `json:"comment"`
	Mention        bool    `json:"mention"`
	IssueCompleted bool    `json:"issue_completed"`
}

type NotificationPreferencesStore interface {
	NotificationPreferencesForSession(ctx context.Context, sessionKey string) (NotificationPreferences, error)
	UpdateNotificationPreferencesForSession(ctx context.Context, sessionKey string, payload map[string]any) (NotificationPreferences, error)
}

type ValidationError map[string]any

func (e ValidationError) Error() string { return "invalid user payload" }

type SettingsReader interface {
	SettingsForSession(context.Context, string) (map[string]any, error)
}

type Handler struct {
	Store             Store
	SessionCookieName string
}

type ProfileHandler struct {
	Store             ProfileStore
	SessionCookieName string
}

func (h ProfileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPatch {
		h.patch(w, r)
		return
	}
	serveSessionResource(w, r, h.SessionCookieName, func(ctx context.Context, session string) (map[string]any, error) {
		if h.Store == nil {
			return nil, errors.New("profile storage is unavailable")
		}
		return h.Store.ProfileForSession(ctx, session)
	})
}

func (h ProfileHandler) patch(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "profile storage is unavailable"})
		return
	}
	var payload map[string]any
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&payload); err != nil || payload == nil {
		writeJSON(w, http.StatusBadRequest, map[string][]string{"non_field_errors": {"Invalid JSON payload."}})
		return
	}
	profile, err := h.Store.UpdateProfileForSession(r.Context(), sessionFromRequest(r, h.SessionCookieName), payload)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		var validation ValidationError
		if errors.As(err, &validation) {
			writeJSON(w, http.StatusBadRequest, validation)
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func sessionFromRequest(r *http.Request, cookieName string) string {
	if cookieName == "" {
		cookieName = "session-id"
	}
	if cookie, err := r.Cookie(cookieName); err == nil {
		return cookie.Value
	}
	return ""
}

type SettingsHandler struct {
	Store             SettingsReader
	SessionCookieName string
}

func (h SettingsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	serveSessionResource(w, r, h.SessionCookieName, func(ctx context.Context, session string) (map[string]any, error) {
		if h.Store == nil {
			return nil, errors.New("settings storage is unavailable")
		}
		return h.Store.SettingsForSession(ctx, session)
	})
}

func serveSessionResource(w http.ResponseWriter, r *http.Request, cookieName string, read func(context.Context, string) (map[string]any, error)) {
	if cookieName == "" {
		cookieName = "session-id"
	}
	sessionKey := ""
	if cookie, err := r.Cookie(cookieName); err == nil {
		sessionKey = cookie.Value
	}
	payload, err := read(r.Context(), sessionKey)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=12")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, payload)
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if r.Method == http.MethodPatch {
		var payload map[string]any
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&payload); err != nil || payload == nil {
			writeJSON(w, http.StatusBadRequest, map[string][]string{"non_field_errors": {"Invalid JSON payload."}})
			return
		}
		current, err := h.Store.UpdateCurrentForSession(r.Context(), sessionKey, payload)
		if err != nil {
			if errors.Is(err, ErrUnauthorized) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
				return
			}
			var validation ValidationError
			if errors.As(err, &validation) {
				writeJSON(w, http.StatusBadRequest, validation)
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, current)
		return
	}
	current, err := h.Store.CurrentForSession(r.Context(), sessionKey)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=12")
	w.Header().Add("Vary", "Cookie")
	writeJSON(w, http.StatusOK, current)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

type SessionHandler struct {
	Store             Store
	SessionCookieName string
}

func (h SessionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if sessionKey == "" {
		writeJSON(w, http.StatusOK, map[string]any{"is_authenticated": false})
		return
	}
	current, err := h.Store.CurrentForSession(r.Context(), sessionKey)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusOK, map[string]any{"is_authenticated": false})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"is_authenticated": true,
		"user":             current,
	})
}

type OnBoardedHandler struct {
	Store             ProfileStore
	SessionCookieName string
}

func (h OnBoardedHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		w.Header().Set("Allow", "PATCH")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "profile storage is unavailable"})
		return
	}
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	var payload struct {
		IsOnboarded bool `json:"is_onboarded"`
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string][]string{"non_field_errors": {"Invalid JSON payload."}})
		return
	}
	_, err := h.Store.UpdateProfileForSession(r.Context(), sessionKey, map[string]any{
		"is_onboarded": payload.IsOnboarded,
	})
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Updated successfully"})
}

type TourCompletedHandler struct {
	Store             ProfileStore
	SessionCookieName string
}

func (h TourCompletedHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		w.Header().Set("Allow", "PATCH")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "profile storage is unavailable"})
		return
	}
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	var payload struct {
		IsTourCompleted bool `json:"is_tour_completed"`
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string][]string{"non_field_errors": {"Invalid JSON payload."}})
		return
	}
	_, err := h.Store.UpdateProfileForSession(r.Context(), sessionKey, map[string]any{
		"is_tour_completed": payload.IsTourCompleted,
	})
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Updated successfully"})
}

type NotificationPreferencesHandler struct {
	Store             NotificationPreferencesStore
	SessionCookieName string
}

func (h NotificationPreferencesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "notification preferences storage is unavailable"})
		return
	}
	sessionKey := sessionFromRequest(r, h.SessionCookieName)

	switch r.Method {
	case http.MethodGet:
		np, err := h.Store.NotificationPreferencesForSession(r.Context(), sessionKey)
		if err != nil {
			if errors.Is(err, ErrUnauthorized) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, np)
	case http.MethodPatch:
		var payload map[string]any
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&payload); err != nil || payload == nil {
			writeJSON(w, http.StatusBadRequest, map[string][]string{"non_field_errors": {"Invalid JSON payload."}})
			return
		}
		np, err := h.Store.UpdateNotificationPreferencesForSession(r.Context(), sessionKey, payload)
		if err != nil {
			if errors.Is(err, ErrUnauthorized) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user storage is unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, np)
	default:
		w.Header().Set("Allow", "GET, PATCH")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
	}
}

type Account struct {
	ID                   string         `json:"id"`
	CreatedBy            string         `json:"created_by"`
	UpdatedBy            string         `json:"updated_by"`
	CreatedAt            time.Time      `json:"created_at"`
	UpdatedAt            time.Time      `json:"updated_at"`
	DeletedAt            *time.Time     `json:"deleted_at"`
	ProviderAccountID    string         `json:"provider_account_id"`
	Provider             string         `json:"provider"`
	AccessToken          string         `json:"access_token"`
	AccessTokenExpiredAt *time.Time     `json:"access_token_expired_at"`
	RefreshToken         *string        `json:"refresh_token"`
	RefreshTokenExpiredAt *time.Time    `json:"refresh_token_expired_at"`
	LastConnectedAt      time.Time      `json:"last_connected_at"`
	IDToken              string         `json:"id_token"`
	Metadata             map[string]any `json:"metadata"`
	User                 string         `json:"user"`
	Workspace            *string        `json:"workspace"`
}

type AccountStore interface {
	AccountsForSession(ctx context.Context, sessionKey string) ([]Account, error)
	DeleteAccountForSession(ctx context.Context, sessionKey string, accountID string) error
}

type AccountHandler struct {
	Store             AccountStore
	SessionCookieName string
}

func (h AccountHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}
	
	if r.Method == http.MethodDelete {
		accountID := r.PathValue("pk")
		if accountID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Account ID is required"})
			return
		}
		
		err := h.Store.DeleteAccountForSession(r.Context(), sessionKey, accountID)
		if err != nil {
			if errors.Is(err, ErrUnauthorized) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "account storage is unavailable"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	
	if r.Method == http.MethodGet {
		accounts, err := h.Store.AccountsForSession(r.Context(), sessionKey)
		if err != nil {
			if errors.Is(err, ErrUnauthorized) {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
				return
			}
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "account storage is unavailable"})
			return
		}
		
		if accounts == nil {
			accounts = []Account{}
		}
		
		writeJSON(w, http.StatusOK, accounts)
		return
	}
	
	w.WriteHeader(http.StatusMethodNotAllowed)
}

type InstanceAdminStore interface {
	IsInstanceAdminForSession(ctx context.Context, sessionKey string) (bool, error)
}

type InstanceAdminHandler struct {
	Store             InstanceAdminStore
	SessionCookieName string
}

func (h InstanceAdminHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sessionKey := sessionFromRequest(r, h.SessionCookieName)
	if sessionKey == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
		return
	}
	
	if r.Method == http.MethodGet {
		isAdmin := false
		if h.Store != nil {
			var err error
			isAdmin, err = h.Store.IsInstanceAdminForSession(r.Context(), sessionKey)
			if err != nil {
				if errors.Is(err, ErrUnauthorized) {
					writeJSON(w, http.StatusUnauthorized, map[string]string{"detail": "Authentication credentials were not provided."})
					return
				}
				// Fail open as non-admin rather than breaking
				isAdmin = false
			}
		}
		writeJSON(w, http.StatusOK, map[string]bool{"is_instance_admin": isAdmin})
		return
	}
	w.WriteHeader(http.StatusMethodNotAllowed)
}
