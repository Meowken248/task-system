package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PasswordUser struct {
	ID              string
	Email           string
	PasswordHash    string
	PasswordAutoset bool
}

type PasswordStore interface {
	UserForSession(context.Context, string) (PasswordUser, error)
	UpdatePassword(context.Context, string, string, string, string) error
}

type PasswordHandler struct {
	Store             PasswordStore
	SessionCookieName string
	SecretKey         string
	SetOnly           bool
	Now               func() time.Time
}

func (h PasswordHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !validCSRFRequest(r) {
		writeAuthJSON(w, http.StatusForbidden, map[string]any{"error": "CSRF verification failed"})
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "session-id"
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie.Value == "" {
		writeAuthJSON(w, http.StatusUnauthorized, map[string]any{"detail": "Authentication credentials were not provided."})
		return
	}
	if h.Store == nil || h.SecretKey == "" {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "password update is not configured"})
		return
	}
	user, err := h.Store.UserForSession(r.Context(), cookie.Value)
	if errors.Is(err, pgx.ErrNoRows) {
		writeAuthJSON(w, http.StatusUnauthorized, map[string]any{"detail": "Invalid or expired session."})
		return
	}
	if err != nil {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "password update temporarily unavailable"})
		return
	}
	var body struct {
		Password    string `json:"password"`
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeAuthError(w, 5138, "MISSING_PASSWORD")
		return
	}
	newPassword := body.NewPassword
	if h.SetOnly {
		newPassword = body.Password
	}
	if h.SetOnly && !user.PasswordAutoset {
		writeAuthJSON(w, http.StatusBadRequest, map[string]any{"error_code": 5145, "error_message": "PASSWORD_ALREADY_SET", "error": "Your password is already set please change your password from profile"})
		return
	}
	if !h.SetOnly && !user.PasswordAutoset {
		if strings.TrimSpace(body.OldPassword) == "" {
			writeAuthJSON(w, http.StatusBadRequest, map[string]any{"error_code": 5138, "error_message": "MISSING_PASSWORD", "error": "Old password is missing"})
			return
		}
		if !verifyDjangoPassword(body.OldPassword, user.PasswordHash) {
			writeAuthJSON(w, http.StatusBadRequest, map[string]any{"error_code": 5135, "error_message": "INCORRECT_OLD_PASSWORD", "error": "Old password is not correct"})
			return
		}
	}
	if strings.TrimSpace(newPassword) == "" {
		writeAuthError(w, 5020, "INVALID_PASSWORD")
		return
	}
	if !strongPassword(newPassword, user.Email) {
		writeAuthError(w, 5021, "PASSWORD_TOO_WEAK")
		return
	}
	hash, err := encodeDjangoPassword(newPassword)
	if err != nil {
		writeAuthJSON(w, http.StatusInternalServerError, map[string]any{"error": "could not hash password"})
		return
	}
	now := time.Now().UTC()
	if h.Now != nil {
		now = h.Now().UTC()
	}
	device := map[string]string{"user_agent": r.UserAgent(), "ip_address": clientIP(r), "domain": requestHost(r)}
	sessionData, err := encodeDjangoSession(user.ID, hash, h.SecretKey, device, now)
	if err != nil {
		writeAuthJSON(w, http.StatusInternalServerError, map[string]any{"error": "could not refresh session"})
		return
	}
	if err = h.Store.UpdatePassword(r.Context(), user.ID, cookie.Value, hash, sessionData); err != nil {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "could not update password"})
		return
	}
	writeAuthJSON(w, http.StatusOK, map[string]any{"id": user.ID, "email": user.Email, "is_password_autoset": false, "message": "Password updated successfully"})
}

type PostgreSQLPasswordStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLPasswordStore) UserForSession(ctx context.Context, sessionKey string) (PasswordUser, error) {
	var user PasswordUser
	err := s.Pool.QueryRow(ctx, `SELECT u.id::text,u.email,u.password,u.is_password_autoset FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.session_key=$1 AND s.expire_date>NOW() AND u.is_active=TRUE`, sessionKey).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.PasswordAutoset)
	return user, err
}
func (s PostgreSQLPasswordStore) UpdatePassword(ctx context.Context, userID, sessionKey, hash, sessionData string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE users SET password=$2,is_password_autoset=FALSE,updated_at=NOW() WHERE id::text=$1`, userID, hash)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	if _, err = tx.Exec(ctx, `DELETE FROM sessions WHERE user_id::text=$1 AND session_key<>$2`, userID, sessionKey); err != nil {
		return err
	}
	result, err = tx.Exec(ctx, `UPDATE sessions SET session_data=$3 WHERE user_id::text=$1 AND session_key=$2`, userID, sessionKey, sessionData)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	return tx.Commit(ctx)
}
