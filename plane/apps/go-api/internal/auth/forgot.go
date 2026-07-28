package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const djangoPasswordResetSalt = "django.contrib.auth.tokens.PasswordResetTokenGenerator"

var djangoEpoch = time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)

type PasswordResetUser struct {
	ID, Email, FirstName, PasswordHash string
	LastLogin                          *time.Time
}
type ForgotPasswordStore interface {
	InstanceReady(context.Context) (bool, error)
	ResetUser(context.Context, string) (PasswordResetUser, error)
}
type ResetEmailSender interface {
	SendPasswordReset(context.Context, PasswordResetUser, string) error
}
type ForgotPasswordHandler struct {
	Store                 ForgotPasswordStore
	Sender                ResetEmailSender
	AppBaseURL, SecretKey string
	Now                   func() time.Time
}

func (h ForgotPasswordHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil || h.Sender == nil || h.SecretKey == "" {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "password reset is not configured"})
		return
	}
	ready, err := h.Store.InstanceReady(r.Context())
	if err != nil {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "password reset temporarily unavailable"})
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
	if !validEmail(email) {
		writeAuthError(w, 5015, "INVALID_EMAIL")
		return
	}
	user, err := h.Store.ResetUser(r.Context(), email)
	if errors.Is(err, pgx.ErrNoRows) {
		writeAuthError(w, 5060, "USER_DOES_NOT_EXIST")
		return
	}
	if err != nil {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "password reset temporarily unavailable"})
		return
	}
	now := time.Now().UTC()
	if h.Now != nil {
		now = h.Now().UTC()
	}
	uid := strings.TrimRight(base64.URLEncoding.EncodeToString([]byte(user.ID)), "=")
	token := makeDjangoPasswordResetToken(user, h.SecretKey, now)
	link := strings.TrimRight(h.AppBaseURL, "/") + "/accounts/reset-password/?" + url.Values{"uidb64": {uid}, "token": {token}, "email": {user.Email}}.Encode()
	if err = h.Sender.SendPasswordReset(r.Context(), user, link); err != nil {
		writeAuthJSON(w, http.StatusServiceUnavailable, map[string]any{"error_code": 5025, "error_message": "SMTP_NOT_CONFIGURED", "error": "Could not send reset email"})
		return
	}
	writeAuthJSON(w, http.StatusOK, map[string]string{"message": "Check your email to reset your password"})
}
func makeDjangoPasswordResetToken(user PasswordResetUser, secret string, now time.Time) string {
	timestamp := int64(now.UTC().Sub(djangoEpoch) / time.Second)
	lastLogin := ""
	if user.LastLogin != nil {
		lastLogin = user.LastLogin.UTC().Truncate(time.Second).Format("2006-01-02 15:04:05")
	}
	value := user.ID + user.PasswordHash + lastLogin + strconv.FormatInt(timestamp, 10) + user.Email
	keyHash := sha256.Sum256([]byte(djangoPasswordResetSalt + secret))
	mac := hmac.New(sha256.New, keyHash[:])
	_, _ = mac.Write([]byte(value))
	full := hex.EncodeToString(mac.Sum(nil))
	half := make([]byte, 0, len(full)/2)
	for i := 0; i < len(full); i += 2 {
		half = append(half, full[i])
	}
	return strconv.FormatInt(timestamp, 36) + "-" + string(half)
}

type PostgreSQLForgotPasswordStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLForgotPasswordStore) InstanceReady(ctx context.Context) (bool, error) {
	var ready bool
	err := s.Pool.QueryRow(ctx, `SELECT is_setup_done FROM instances WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`).Scan(&ready)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return ready, err
}
func (s PostgreSQLForgotPasswordStore) ResetUser(ctx context.Context, email string) (PasswordResetUser, error) {
	var u PasswordResetUser
	err := s.Pool.QueryRow(ctx, `SELECT id::text,email,first_name,password,last_login FROM users WHERE LOWER(email)=LOWER($1) AND is_active=TRUE LIMIT 1`, email).Scan(&u.ID, &u.Email, &u.FirstName, &u.PasswordHash, &u.LastLogin)
	return u, err
}

type SMTPResetSender struct {
	Host, Port, Username, Password, From string
	UseTLS, UseSSL                       bool
}

func (s SMTPResetSender) SendPasswordReset(ctx context.Context, user PasswordResetUser, link string) error {
	if strings.TrimSpace(s.Host) == "" {
		return errors.New("SMTP host is not configured")
	}
	port := s.Port
	if port == "" {
		port = "587"
	}
	address := net.JoinHostPort(s.Host, port)
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	if s.UseSSL {
		conn = tls.Client(conn, &tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12})
	}
	client, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		return err
	}
	defer client.Close()
	if s.UseTLS && !s.UseSSL {
		if err = client.StartTLS(&tls.Config{ServerName: s.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return err
		}
	}
	if s.Username != "" {
		if err = client.Auth(smtp.PlainAuth("", s.Username, s.Password, s.Host)); err != nil {
			return err
		}
	}
	from := mailboxAddress(s.From)
	if from == "" {
		from = s.Username
	}
	if from == "" {
		return errors.New("SMTP from address is not configured")
	}
	if err = client.Mail(from); err != nil {
		return err
	}
	if err = client.Rcpt(user.Email); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	name := user.FirstName
	if name == "" {
		name = user.Email
	}
	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: A new password to your Plane account has been requested\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nHello %s,\r\n\r\nOpen this link to reset your Plane password:\r\n%s\r\n", s.From, user.Email, name, link)
	if _, err = writer.Write([]byte(message)); err != nil {
		return err
	}
	if err = writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}
func mailboxAddress(value string) string {
	value = strings.TrimSpace(value)
	if start := strings.LastIndex(value, "<"); start >= 0 && strings.HasSuffix(value, ">") {
		return strings.TrimSpace(value[start+1 : len(value)-1])
	}
	return value
}
