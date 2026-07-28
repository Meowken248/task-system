package auth

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultPasswordResetTimeout = 72 * time.Hour

type ResetPasswordStore interface {
	ResetUserByID(context.Context, string) (PasswordResetUser, error)
	SetResetPassword(context.Context, string, string) error
}

type ResetPasswordHandler struct {
	Store      ResetPasswordStore
	AppBaseURL string
	SecretKey  string
	Timeout    time.Duration
	Now        func() time.Time
}

func (h ResetPasswordHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !validCSRFRequest(r) {
		h.redirectError(w, r, 5125, "INVALID_PASSWORD_TOKEN")
		return
	}
	if h.Store == nil || h.SecretKey == "" {
		http.Error(w, "password reset is not configured", http.StatusServiceUnavailable)
		return
	}
	uid, err := decodeResetUID(r.PathValue("uidb64"))
	if err != nil {
		h.redirectError(w, r, 5125, "INVALID_PASSWORD_TOKEN")
		return
	}
	user, err := h.Store.ResetUserByID(r.Context(), uid)
	if errors.Is(err, pgx.ErrNoRows) {
		h.redirectError(w, r, 5125, "INVALID_PASSWORD_TOKEN")
		return
	}
	if err != nil {
		http.Error(w, "password reset temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	now := time.Now().UTC()
	if h.Now != nil {
		now = h.Now().UTC()
	}
	timeout := h.Timeout
	if timeout <= 0 {
		timeout = defaultPasswordResetTimeout
	}
	valid, expired := checkDjangoPasswordResetToken(user, h.SecretKey, r.PathValue("token"), now, timeout)
	if !valid {
		if expired {
			h.redirectError(w, r, 5130, "EXPIRED_PASSWORD_TOKEN")
		} else {
			h.redirectError(w, r, 5125, "INVALID_PASSWORD_TOKEN")
		}
		return
	}
	password := r.FormValue("password")
	if strings.TrimSpace(password) == "" {
		h.redirectError(w, r, 5020, "INVALID_PASSWORD")
		return
	}
	if !strongPassword(password, user.Email) {
		h.redirectError(w, r, 5021, "PASSWORD_TOO_WEAK")
		return
	}
	hash, err := encodeDjangoPassword(password)
	if err != nil {
		http.Error(w, "could not hash password", http.StatusInternalServerError)
		return
	}
	if err = h.Store.SetResetPassword(r.Context(), user.ID, hash); err != nil {
		http.Error(w, "could not update password", http.StatusServiceUnavailable)
		return
	}
	http.Redirect(w, r, joinAppURL(h.AppBaseURL, "/sign-in", url.Values{"success": {"True"}}), http.StatusFound)
}

func (h ResetPasswordHandler) redirectError(w http.ResponseWriter, r *http.Request, code int, message string) {
	http.Redirect(w, r, joinAppURL(h.AppBaseURL, "/accounts/reset-password", url.Values{
		"error_code": {fmt.Sprint(code)}, "error_message": {message},
	}), http.StatusFound)
}

func decodeResetUID(value string) (string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(strings.TrimSpace(value), "="))
	if err != nil || len(decoded) == 0 {
		return "", errors.New("invalid reset uid")
	}
	return string(decoded), nil
}

func checkDjangoPasswordResetToken(user PasswordResetUser, secret, token string, now time.Time, timeout time.Duration) (valid bool, expired bool) {
	parts := strings.Split(token, "-")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false, false
	}
	timestamp, err := strconv.ParseInt(parts[0], 36, 64)
	if err != nil || timestamp < 0 {
		return false, false
	}
	tokenTime := djangoEpoch.Add(time.Duration(timestamp) * time.Second)
	if now.UTC().Sub(tokenTime) > timeout {
		return false, true
	}
	if tokenTime.After(now.UTC().Add(time.Minute)) {
		return false, false
	}
	expected := makeDjangoPasswordResetToken(user, secret, tokenTime)
	return subtle.ConstantTimeCompare([]byte(expected), []byte(token)) == 1, false
}

type PostgreSQLResetPasswordStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLResetPasswordStore) ResetUserByID(ctx context.Context, userID string) (PasswordResetUser, error) {
	var user PasswordResetUser
	err := s.Pool.QueryRow(ctx, `SELECT id::text,email,first_name,password,last_login FROM users WHERE id::text=$1 AND is_active=TRUE LIMIT 1`, userID).Scan(&user.ID, &user.Email, &user.FirstName, &user.PasswordHash, &user.LastLogin)
	return user, err
}

func (s PostgreSQLResetPasswordStore) SetResetPassword(ctx context.Context, userID, passwordHash string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE users SET password=$2,is_password_autoset=FALSE,updated_at=NOW() WHERE id::text=$1 AND is_active=TRUE`, userID, passwordHash)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	if _, err = tx.Exec(ctx, `DELETE FROM sessions WHERE user_id::text=$1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
