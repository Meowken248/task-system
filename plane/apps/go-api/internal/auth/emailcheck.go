package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type EmailCheckResult struct {
	Exists            bool
	PasswordAutoset   bool
	SMTPConfigured    bool
	MagicLoginEnabled bool
}

type EmailCheckStore interface {
	CheckEmail(context.Context, string) (EmailCheckResult, error)
	InstanceReady(context.Context) (bool, error)
}

type EmailCheckHandler struct{ Store EmailCheckStore }

func (h EmailCheckHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "email check is not configured"})
		return
	}
	ready, err := h.Store.InstanceReady(r.Context())
	if err != nil {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "email check temporarily unavailable"})
		return
	}
	if !ready {
		writeAuthError(w, 5005, "INSTANCE_NOT_CONFIGURED")
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeAuthError(w, 5010, "EMAIL_REQUIRED")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if email == "" {
		writeAuthError(w, 5010, "EMAIL_REQUIRED")
		return
	}
	if !validEmail(email) {
		writeAuthError(w, 5015, "INVALID_EMAIL")
		return
	}
	result, err := h.Store.CheckEmail(r.Context(), email)
	if err != nil {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "email check temporarily unavailable"})
		return
	}
	status := "CREDENTIAL"
	if result.SMTPConfigured && result.MagicLoginEnabled && (!result.Exists || result.PasswordAutoset) {
		status = "MAGIC_CODE"
	}
	writeAuthJSON(w, http.StatusOK, map[string]any{"existing": result.Exists, "status": status, "is_password_autoset": result.PasswordAutoset})
}

type PostgreSQLEmailCheckStore struct {
	Pool             *pgxpool.Pool
	EmailHost        string
	EnableMagicLogin bool
}

func (s PostgreSQLEmailCheckStore) InstanceReady(ctx context.Context) (bool, error) {
	var ready bool
	err := s.Pool.QueryRow(ctx, `SELECT is_setup_done FROM instances WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`).Scan(&ready)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return ready, err
}

func (s PostgreSQLEmailCheckStore) CheckEmail(ctx context.Context, email string) (EmailCheckResult, error) {
	result := EmailCheckResult{SMTPConfigured: strings.TrimSpace(s.EmailHost) != "", MagicLoginEnabled: s.EnableMagicLogin}
	rows, err := s.Pool.Query(ctx, `SELECT key, COALESCE(value, '') FROM instance_configurations WHERE key IN ('EMAIL_HOST','ENABLE_MAGIC_LINK_LOGIN') AND deleted_at IS NULL`)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if err = rows.Scan(&key, &value); err != nil {
			return result, err
		}
		switch key {
		case "EMAIL_HOST":
			result.SMTPConfigured = strings.TrimSpace(value) != ""
		case "ENABLE_MAGIC_LINK_LOGIN":
			value = strings.ToLower(strings.TrimSpace(value))
			result.MagicLoginEnabled = value == "1" || value == "true" || value == "yes" || value == "on"
		}
	}
	if err = rows.Err(); err != nil {
		return result, err
	}
	err = s.Pool.QueryRow(ctx, `SELECT is_password_autoset FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`, email).Scan(&result.PasswordAutoset)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.Exists = true
	return result, nil
}

func writeAuthError(w http.ResponseWriter, code int, message string) {
	writeAuthJSON(w, http.StatusBadRequest, map[string]any{"error_code": code, "error_message": message})
}
func writeAuthJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
