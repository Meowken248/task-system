package auth

import (
	"context"
	"crypto/subtle"
	"net"
	"net/http"
	"strings"
)

type SessionRevoker interface {
	Revoke(context.Context, string, string) error
}

type SignOutHandler struct {
	Store             SessionRevoker
	SessionCookieName string
	CookieDomain      string
	RedirectURL       string
}

func (h SignOutHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !validCSRFRequest(r) {
		http.Error(w, "CSRF verification failed", http.StatusForbidden)
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "session-id"
	}
	if cookie, err := r.Cookie(cookieName); err == nil && cookie.Value != "" && h.Store != nil {
		if err := h.Store.Revoke(r.Context(), cookie.Value, clientIP(r)); err != nil {
			http.Error(w, "could not revoke session", http.StatusServiceUnavailable)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", Domain: h.CookieDomain,
		MaxAge: -1, HttpOnly: true, Secure: requestIsSecure(r), SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, h.RedirectURL, http.StatusFound)
}

func validCSRFRequest(r *http.Request) bool {
	cookie, err := r.Cookie(csrfCookieName)
	if err != nil || len(cookie.Value) != csrfSecretSize {
		return false
	}
	if err := r.ParseForm(); err != nil {
		return false
	}
	token := r.FormValue("csrfmiddlewaretoken")
	if token == "" {
		token = r.Header.Get("X-CSRFToken")
	}
	secret, ok := unmaskToken(token)
	return ok && subtle.ConstantTimeCompare([]byte(secret), []byte(cookie.Value)) == 1
}

func unmaskToken(token string) (string, bool) {
	if len(token) == csrfSecretSize {
		return token, validAllowedString(token)
	}
	if len(token) != csrfSecretSize*2 {
		return "", false
	}
	mask := token[:csrfSecretSize]
	cipher := token[csrfSecretSize:]
	var secret strings.Builder
	secret.Grow(csrfSecretSize)
	for i := range cipher {
		cipherIndex := strings.IndexByte(allowedChars, cipher[i])
		maskIndex := strings.IndexByte(allowedChars, mask[i])
		if cipherIndex < 0 || maskIndex < 0 {
			return "", false
		}
		index := cipherIndex - maskIndex
		if index < 0 {
			index += len(allowedChars)
		}
		secret.WriteByte(allowedChars[index])
	}
	return secret.String(), true
}

func validAllowedString(value string) bool {
	for i := range value {
		if strings.IndexByte(allowedChars, value[i]) < 0 {
			return false
		}
	}
	return true
}

func clientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
		return forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
