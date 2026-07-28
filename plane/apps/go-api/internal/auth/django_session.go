package auth

import (
	"bytes"
	"compress/zlib"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const djangoSessionSalt = "django.contrib.sessions.SessionStore"
const djangoAuthHashSalt = "django.contrib.auth.models.AbstractBaseUser.get_session_auth_hash"
const djangoAuthBackend = "django.contrib.auth.backends.ModelBackend"
const base62Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

func encodeDjangoSession(userID, passwordHash, secret string, deviceInfo map[string]string, now time.Time) (string, error) {
	if secret == "" {
		return "", fmt.Errorf("SECRET_KEY is required for Django-compatible sessions")
	}
	payload := map[string]any{
		"_auth_user_id":      userID,
		"_auth_user_backend": djangoAuthBackend,
		"_auth_user_hash":    djangoSessionAuthHash(passwordHash, secret),
		"device_info":        deviceInfo,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal session: %w", err)
	}
	data := raw
	compressed := false
	var buffer bytes.Buffer
	writer := zlib.NewWriter(&buffer)
	if _, err = writer.Write(raw); err == nil {
		err = writer.Close()
	}
	if err != nil {
		return "", fmt.Errorf("compress session: %w", err)
	}
	if buffer.Len() < len(raw)-1 {
		data = buffer.Bytes()
		compressed = true
	}
	encoded := strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
	if compressed {
		encoded = "." + encoded
	}
	timestamped := encoded + ":" + base62(now.Unix())
	signature := djangoSignature(djangoSessionSalt+"signer", timestamped, secret)
	return timestamped + ":" + signature, nil
}

func djangoSessionAuthHash(passwordHash, secret string) string {
	key := sha256.Sum256([]byte(djangoAuthHashSalt + secret))
	mac := hmac.New(sha256.New, key[:])
	_, _ = mac.Write([]byte(passwordHash))
	return fmt.Sprintf("%x", mac.Sum(nil))
}

func djangoSignature(salt, value, secret string) string {
	key := sha256.Sum256([]byte(salt + secret))
	mac := hmac.New(sha256.New, key[:])
	_, _ = mac.Write([]byte(value))
	return strings.TrimRight(base64.URLEncoding.EncodeToString(mac.Sum(nil)), "=")
}

func base62(value int64) string {
	if value == 0 {
		return "0"
	}
	var result [16]byte
	cursor := len(result)
	for value > 0 {
		cursor--
		result[cursor] = base62Alphabet[value%62]
		value /= 62
	}
	return string(result[cursor:])
}

func parseDjangoSessionTimestamp(value string) (int64, error) {
	var result int64
	for _, char := range value {
		index := strings.IndexRune(base62Alphabet, char)
		if index < 0 {
			return 0, fmt.Errorf("invalid base62 timestamp %q", value)
		}
		result = result*62 + int64(index)
	}
	if value == "" {
		return 0, strconv.ErrSyntax
	}
	return result, nil
}
