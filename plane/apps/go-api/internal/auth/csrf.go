package auth

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

const (
	csrfCookieName = "csrftoken"
	csrfSecretSize = 32
	allowedChars   = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

type CSRFHandler struct {
	CookieDomain string
}

func (h CSRFHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	secret, err := randomString(csrfSecretSize)
	if err != nil {
		http.Error(w, "could not generate CSRF token", http.StatusInternalServerError)
		return
	}
	token, err := maskSecret(secret)
	if err != nil {
		http.Error(w, "could not generate CSRF token", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: csrfCookieName, Value: secret, Path: "/", Domain: h.CookieDomain,
		MaxAge: 31449600, HttpOnly: true, Secure: requestIsSecure(r), SameSite: http.SameSiteLaxMode,
	})
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]string{"csrf_token": token})
}

func maskSecret(secret string) (string, error) {
	if len(secret) != csrfSecretSize {
		return "", errors.New("invalid CSRF secret size")
	}
	mask, err := randomString(csrfSecretSize)
	if err != nil {
		return "", err
	}
	var token strings.Builder
	token.Grow(csrfSecretSize * 2)
	token.WriteString(mask)
	for i := range secret {
		secretIndex := strings.IndexByte(allowedChars, secret[i])
		maskIndex := strings.IndexByte(allowedChars, mask[i])
		if secretIndex < 0 || maskIndex < 0 {
			return "", errors.New("invalid CSRF character")
		}
		token.WriteByte(allowedChars[(secretIndex+maskIndex)%len(allowedChars)])
	}
	return token.String(), nil
}

func randomString(size int) (string, error) {
	result := make([]byte, size)
	random := make([]byte, size)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	for i := range result {
		result[i] = allowedChars[int(random[i])%len(allowedChars)]
	}
	return string(result), nil
}

func requestIsSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https")
}
