package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/pbkdf2"
)

const djangoPBKDF2Iterations = 600000

type SignUpAccount struct {
	ID           string
	Email        string
	Username     string
	DisplayName  string
	PasswordHash string
	ProfileID    string
	PreferenceID string
	Session      LoginSession
}

type SignUpStore interface {
	CanSignUp(context.Context, string) (bool, error)
	UserExists(context.Context, string) (bool, error)
	CreateAccount(context.Context, SignUpAccount) error
}

type SignUpHandler struct {
	Store             SignUpStore
	SessionCookieName string
	CookieDomain      string
	AppBaseURL        string
	SecretKey         string
	SessionAge        time.Duration
	Now               func() time.Time
}

func (h SignUpHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.FormValue("email")))
	if !validCSRFRequest(r) {
		h.redirectError(w, r, 5040, "REQUIRED_EMAIL_PASSWORD_SIGN_UP", email)
		return
	}
	password := r.FormValue("password")
	if email == "" || password == "" {
		h.redirectError(w, r, 5040, "REQUIRED_EMAIL_PASSWORD_SIGN_UP", email)
		return
	}
	if !validEmail(email) {
		h.redirectError(w, r, 5045, "INVALID_EMAIL_SIGN_UP", email)
		return
	}
	if h.Store == nil || h.SecretKey == "" {
		http.Error(w, "email sign-up is not configured", http.StatusServiceUnavailable)
		return
	}
	allowed, err := h.Store.CanSignUp(r.Context(), email)
	if err != nil {
		http.Error(w, "sign-up temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	if !allowed {
		h.redirectError(w, r, 5015, "SIGNUP_DISABLED", email)
		return
	}
	exists, err := h.Store.UserExists(r.Context(), email)
	if err != nil {
		http.Error(w, "sign-up temporarily unavailable", http.StatusServiceUnavailable)
		return
	}
	if exists {
		h.redirectError(w, r, 5030, "USER_ALREADY_EXIST", email)
		return
	}
	if !strongPassword(password, email) {
		h.redirectError(w, r, 5021, "PASSWORD_TOO_WEAK", email)
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
	userID, err := randomUUID()
	if err != nil {
		http.Error(w, "could not create account", http.StatusInternalServerError)
		return
	}
	profileID, err := randomUUID()
	if err != nil {
		http.Error(w, "could not create account", http.StatusInternalServerError)
		return
	}
	preferenceID, err := randomUUID()
	if err != nil {
		http.Error(w, "could not create account", http.StatusInternalServerError)
		return
	}
	username, err := randomString(32)
	if err != nil {
		http.Error(w, "could not create account", http.StatusInternalServerError)
		return
	}
	passwordHash, err := encodeDjangoPassword(password)
	if err != nil {
		http.Error(w, "could not create account", http.StatusInternalServerError)
		return
	}
	sessionKey, err := randomString(32)
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
	sessionData, err := encodeDjangoSession(userID, passwordHash, h.SecretKey, device, now)
	if err != nil {
		http.Error(w, "could not create session", http.StatusInternalServerError)
		return
	}
	account := SignUpAccount{
		ID: userID, Email: email, Username: username, DisplayName: strings.Split(email, "@")[0],
		PasswordHash: passwordHash, ProfileID: profileID, PreferenceID: preferenceID,
		Session: LoginSession{
			Key: sessionKey, Data: sessionData, UserID: userID, ExpiresAt: now.Add(age),
			DeviceInfo: device, LoginIP: clientIP(r), UserAgent: r.UserAgent(),
			Token: fmt.Sprintf("%x", tokenBytes),
		},
	}
	if err = h.Store.CreateAccount(r.Context(), account); err != nil {
		if isUniqueViolation(err) {
			h.redirectError(w, r, 5030, "USER_ALREADY_EXIST", email)
			return
		}
		http.Error(w, "could not persist account", http.StatusServiceUnavailable)
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "session-id"
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: sessionKey, Path: "/", Domain: h.CookieDomain,
		MaxAge: int(age.Seconds()), Expires: now.Add(age), HttpOnly: true,
		Secure: requestIsSecure(r), SameSite: http.SameSiteLaxMode,
	})
	path := safeNextPath(r.FormValue("next_path"))
	if path == "" {
		path = "/onboarding"
	}
	http.Redirect(w, r, joinAppURL(h.AppBaseURL, path, nil), http.StatusFound)
}

func (h SignUpHandler) redirectError(w http.ResponseWriter, r *http.Request, code int, message, email string) {
	values := url.Values{"error_code": {fmt.Sprint(code)}, "error_message": {message}}
	if email != "" {
		values.Set("email", email)
	}
	http.Redirect(w, r, joinAppURL(h.AppBaseURL, safeNextPath(r.FormValue("next_path")), values), http.StatusFound)
}

func strongPassword(password, email string) bool {
	if len([]rune(password)) < 10 || strings.Contains(strings.ToLower(password), strings.Split(email, "@")[0]) {
		return false
	}
	var lower, upper, digit, symbol bool
	for _, char := range password {
		switch {
		case unicode.IsLower(char):
			lower = true
		case unicode.IsUpper(char):
			upper = true
		case unicode.IsDigit(char):
			digit = true
		default:
			symbol = true
		}
	}
	classes := 0
	for _, present := range []bool{lower, upper, digit, symbol} {
		if present {
			classes++
		}
	}
	return classes >= 3
}

func encodeDjangoPassword(password string) (string, error) {
	salt, err := randomString(22)
	if err != nil {
		return "", err
	}
	hash := pbkdf2.Key([]byte(password), []byte(salt), djangoPBKDF2Iterations, 32, sha256.New)
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", djangoPBKDF2Iterations, salt, base64.StdEncoding.EncodeToString(hash)), nil
}

// EncodeDjangoPassword creates a password hash compatible with Plane/Django.
func EncodeDjangoPassword(password string) (string, error) {
	return encodeDjangoPassword(password)
}

func randomUUID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16]), nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

type PostgreSQLSignUpStore struct {
	Pool                *pgxpool.Pool
	EnableSignUp        bool
	EnableEmailPassword bool
}

func (s PostgreSQLSignUpStore) CanSignUp(ctx context.Context, email string) (bool, error) {
	if !s.EnableEmailPassword {
		return false, nil
	}
	if s.EnableSignUp {
		return true, nil
	}
	var invited bool
	err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM workspace_member_invites
			WHERE LOWER(email)=LOWER($1) AND deleted_at IS NULL
		)`, email).Scan(&invited)
	return invited, err
}

func (s PostgreSQLSignUpStore) UserExists(ctx context.Context, email string) (bool, error) {
	var exists bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE LOWER(email)=LOWER($1))`, email).Scan(&exists)
	return exists, err
}

func (s PostgreSQLSignUpStore) CreateAccount(ctx context.Context, account SignUpAccount) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `
		INSERT INTO users (
			password,last_login,id,username,mobile_number,email,first_name,last_name,avatar,
			date_joined,created_at,updated_at,last_location,created_location,is_superuser,is_managed,
			is_password_expired,is_active,is_staff,is_email_verified,is_password_autoset,
			is_password_reset_required,token,user_timezone,last_active,last_login_time,last_logout_time,
			last_login_ip,last_logout_ip,last_login_medium,last_login_uagent,token_updated_at,is_bot,
			cover_image,display_name,avatar_asset_id,cover_image_asset_id,bot_type,is_email_valid,
			masked_at,metanode_wallet_address
		) VALUES (
			$1,NULL,$2,$3,NULL,$4,'','', '',$5,$5,$5,'','',FALSE,FALSE,FALSE,TRUE,FALSE,FALSE,FALSE,
			FALSE,$6,'UTC',$5,$5,NULL,$7,'','email',$8,$5,FALSE,NULL,$9,NULL,NULL,NULL,FALSE,NULL,NULL
		)`,
		account.PasswordHash, account.ID, account.Username, account.Email, now, account.Session.Token,
		account.Session.LoginIP, account.Session.UserAgent, account.DisplayName,
	)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO profiles (
			created_at,updated_at,id,theme,is_tour_completed,onboarding_step,use_case,role,is_onboarded,
			last_workspace_id,billing_address_country,billing_address,has_billing_address,company_name,
			user_id,is_mobile_onboarded,mobile_onboarding_step,mobile_timezone_auto_set,language,
			is_smooth_cursor_enabled,start_of_the_week,is_app_rail_docked,background_color,goals,
			has_marketing_email_consent,is_navigation_tour_completed,is_subscribed_to_changelog,
			notification_view_mode,product_tour
		) VALUES (
			$1,$1,$2,'{}'::jsonb,FALSE,
			'{"profile_complete":false,"workspace_create":false,"workspace_invite":false,"workspace_join":false}'::jsonb,
			NULL,NULL,FALSE,NULL,'INDIA',NULL,FALSE,'',$3,FALSE,
			'{"profile_complete":false,"workspace_create":false,"workspace_join":false}'::jsonb,
			FALSE,'en',FALSE,0,TRUE,$4,'{}'::jsonb,FALSE,FALSE,FALSE,'full',
			'{"work_items":false,"cycles":false,"modules":false,"intake":false,"pages":false}'::jsonb
		)`, now, account.ProfileID, account.ID, "#3b82f6")
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO user_notification_preferences (
			created_at,updated_at,id,property_change,state_change,comment,mention,issue_completed,
			created_by_id,project_id,updated_by_id,user_id,workspace_id,deleted_at
		) VALUES ($1,$1,$2,TRUE,TRUE,TRUE,TRUE,TRUE,NULL,NULL,NULL,$3,NULL,NULL)`,
		now, account.PreferenceID, account.ID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO sessions (session_key,session_data,expire_date,device_info,user_id)
		VALUES ($1,$2,$3,$4,$5)`,
		account.Session.Key, account.Session.Data, account.Session.ExpiresAt,
		account.Session.DeviceInfo, account.ID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
