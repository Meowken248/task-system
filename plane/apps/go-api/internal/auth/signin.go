package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"crypto/sha256"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/pbkdf2"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

type LoginUser struct {
	ID           string
	Email        string
	PasswordHash string
	IsActive     bool
}

type LoginSession struct {
	Key        string
	Data       string
	UserID     string
	ExpiresAt  time.Time
	DeviceInfo map[string]string
	LoginIP    string
	UserAgent  string
	Token      string
}

type SignInStore interface {
	FindLoginUser(context.Context, string) (LoginUser, error)
	CreateLoginSession(context.Context, LoginSession) error
	RedirectPath(context.Context, string, string) (string, error)
}

type SignInHandler struct {
	Store             SignInStore
	SessionCookieName string
	CookieDomain      string
	AppBaseURL        string
	SecretKey         string
	SessionAge        time.Duration
	Now               func() time.Time
}

func (h SignInHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !validCSRFRequest(r) {
		h.redirectError(w, r, 5070, "REQUIRED_EMAIL_PASSWORD_SIGN_IN", "")
		return
	}
	email := strings.ToLower(strings.TrimSpace(r.FormValue("email")))
	password := r.FormValue("password")
	if email == "" || password == "" {
		h.redirectError(w, r, 5070, "REQUIRED_EMAIL_PASSWORD_SIGN_IN", email)
		return
	}
	if !validEmail(email) {
		h.redirectError(w, r, 5075, "INVALID_EMAIL_SIGN_IN", email)
		return
	}
	if h.Store == nil || h.SecretKey == "" {
		http.Error(w, "email sign-in is not configured", http.StatusServiceUnavailable)
		return
	}
	user, err := h.Store.FindLoginUser(r.Context(), email)
	if errors.Is(err, pgx.ErrNoRows) {
		h.redirectError(w, r, 5060, "USER_DOES_NOT_EXIST", email)
		return
	}
	if err != nil {
		http.Error(w, "sign-in temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	if !user.IsActive || !verifyDjangoPassword(password, user.PasswordHash) {
		h.redirectError(w, r, 5065, "AUTHENTICATION_FAILED_SIGN_IN", email)
		return
	}
	now := time.Now().UTC()
	if h.Now != nil {
		now = h.Now().UTC()
	}
	age := h.SessionAge
	if age <= 0 {
		age = 7 * 24 * time.Hour
	}
	key, err := randomString(32)
	if err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	tokenBytes := make([]byte, 32)
	if _, err = rand.Read(tokenBytes); err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	device := map[string]string{"user_agent": r.UserAgent(), "ip_address": clientIP(r), "domain": requestHost(r)}
	data, err := encodeDjangoSession(user.ID, user.PasswordHash, h.SecretKey, device, now)
	if err != nil {
		http.Error(w, "could not encode session", http.StatusInternalServerError)
		return
	}
	err = h.Store.CreateLoginSession(r.Context(), LoginSession{Key: key, Data: data, UserID: user.ID, ExpiresAt: now.Add(age), DeviceInfo: device, LoginIP: clientIP(r), UserAgent: r.UserAgent(), Token: fmt.Sprintf("%x", tokenBytes)})
	if err != nil {
		http.Error(w, "could not persist session", http.StatusServiceUnavailable)
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "session-id"
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: key, Path: "/", Domain: h.CookieDomain, MaxAge: int(age.Seconds()), Expires: now.Add(age), HttpOnly: true, Secure: requestIsSecure(r), SameSite: http.SameSiteLaxMode})
	path := safeNextPath(r.FormValue("next_path"))
	if path == "" {
		path, err = h.Store.RedirectPath(r.Context(), user.ID, user.Email)
		if err != nil || path == "" {
			path = "/"
		}
	}
	http.Redirect(w, r, joinAppURL(h.AppBaseURL, path, nil), http.StatusFound)
}

func (h SignInHandler) redirectError(w http.ResponseWriter, r *http.Request, code int, message, email string) {
	values := url.Values{"error_code": {fmt.Sprint(code)}, "error_message": {message}}
	if email != "" {
		values.Set("email", email)
	}
	http.Redirect(w, r, joinAppURL(h.AppBaseURL, safeNextPath(r.FormValue("next_path")), values), http.StatusFound)
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && strings.EqualFold(address.Address, value) && strings.Contains(value, "@")
}

func verifyDjangoPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	var iterations int
	if _, err := fmt.Sscan(parts[1], &iterations); err != nil || iterations <= 0 {
		return false
	}
	expected, err := base64.StdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	actual := pbkdf2.Key([]byte(password), []byte(parts[2]), iterations, len(expected), sha256.New)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func safeNextPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "//") {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" {
		return ""
	}
	if !strings.HasPrefix(parsed.Path, "/") {
		parsed.Path = "/" + parsed.Path
	}
	return parsed.String()
}

func joinAppURL(base, path string, query url.Values) string {
	base = strings.TrimRight(base, "/")
	if base == "" {
		base = "http://localhost:3000"
	}
	if path == "" {
		path = "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	result := base + path
	if len(query) != 0 {
		separator := "?"
		if strings.Contains(result, "?") {
			separator = "&"
		}
		result += separator + query.Encode()
	}
	return result
}

func requestHost(r *http.Request) string {
	if host := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0]); host != "" {
		return host
	}
	return r.Host
}

type PostgreSQLSignInStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLSignInStore) FindLoginUser(ctx context.Context, email string) (LoginUser, error) {
	var user LoginUser
	err := s.Pool.QueryRow(ctx, `SELECT id::text, email, password, is_active FROM users WHERE LOWER(email) = $1 LIMIT 1`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.IsActive)
	return user, err
}

func (s PostgreSQLSignInStore) CreateLoginSession(ctx context.Context, session LoginSession) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO sessions (session_key, session_data, expire_date, device_info, user_id) VALUES ($1,$2,$3,$4,$5)`, session.Key, session.Data, session.ExpiresAt, session.DeviceInfo, session.UserID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE users SET last_active=NOW(), last_login_time=NOW(), last_login_ip=$2, last_login_uagent=$3, last_login_medium='email', token=$4, token_updated_at=NOW(), updated_at=NOW() WHERE id::text=$1`, session.UserID, session.LoginIP, session.UserAgent, session.Token)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s PostgreSQLSignInStore) RedirectPath(ctx context.Context, userID, email string) (string, error) {
	var onboarded bool
	var lastWorkspaceID *string
	err := s.Pool.QueryRow(ctx, `SELECT is_onboarded, last_workspace_id::text FROM profiles WHERE user_id::text=$1 AND deleted_at IS NULL LIMIT 1`, userID).Scan(&onboarded, &lastWorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "/onboarding", nil
	}
	if err != nil {
		return "", err
	}
	if !onboarded {
		return "/onboarding", nil
	}
	var slug string
	if lastWorkspaceID != nil {
		err = s.Pool.QueryRow(ctx, `SELECT w.slug FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id::text=$1 AND wm.is_active=TRUE AND wm.deleted_at IS NULL WHERE w.id::text=$2 AND w.deleted_at IS NULL LIMIT 1`, userID, *lastWorkspaceID).Scan(&slug)
		if err == nil {
			return "/" + slug, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	err = s.Pool.QueryRow(ctx, `SELECT w.slug FROM workspaces w JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id::text=$1 AND wm.is_active=TRUE AND wm.deleted_at IS NULL WHERE w.deleted_at IS NULL ORDER BY w.created_at LIMIT 1`, userID).Scan(&slug)
	if err == nil {
		return "/" + slug, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	var invited bool
	err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_member_invites WHERE LOWER(email)=LOWER($1) AND deleted_at IS NULL)`, email).Scan(&invited)
	if err != nil {
		return "", err
	}
	if invited {
		return "/invitations", nil
	}
	return "/create-workspace", nil
}
