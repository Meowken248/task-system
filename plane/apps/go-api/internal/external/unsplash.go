package external

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUnauthorized = errors.New("authentication required")

type UnsplashStore interface {
	AccessKeyForSession(context.Context, string) (string, error)
}

type UnsplashHandler struct {
	Store             UnsplashStore
	SessionCookieName string
	Client            *http.Client
}

func (h UnsplashHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cookieName := h.SessionCookieName
	if cookieName == "" {
		cookieName = "session-id"
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil || h.Store == nil {
		http.Error(w, `{"detail":"Authentication credentials were not provided."}`, http.StatusUnauthorized)
		return
	}
	accessKey, err := h.Store.AccessKeyForSession(r.Context(), cookie.Value)
	if errors.Is(err, ErrUnauthorized) {
		http.Error(w, `{"detail":"Authentication credentials were not provided."}`, http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"An internal error has occurred."}`, http.StatusInternalServerError)
		return
	}
	if accessKey == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("[]"))
		return
	}

	query := r.URL.Query().Get("query")
	page := defaultQuery(r.URL.Query().Get("page"), "1")
	perPage := defaultQuery(r.URL.Query().Get("per_page"), "20")
	values := url.Values{"client_id": {accessKey}, "page": {page}, "per_page": {perPage}}
	path := "https://api.unsplash.com/photos/"
	if query != "" {
		path = "https://api.unsplash.com/search/photos/"
		values.Set("query", query)
		// Preserve Django's literal '$' before page on search requests.
		values.Set("page", "$"+page)
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, path+"?"+values.Encode(), nil)
	if err != nil {
		http.Error(w, `{"error":"An internal error has occurred."}`, http.StatusInternalServerError)
		return
	}
	request.Header.Set("Content-Type", "application/json")
	client := h.Client
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		http.Error(w, `{"error":"An internal error has occurred."}`, http.StatusInternalServerError)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func defaultQuery(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

type PostgreSQLUnsplashStore struct {
	Pool           *pgxpool.Pool
	FallbackKey    string
	UseDatabaseKey bool
}

func (s PostgreSQLUnsplashStore) AccessKeyForSession(ctx context.Context, sessionKey string) (string, error) {
	if s.Pool == nil {
		return "", errors.New("database unavailable")
	}
	var authenticated bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM sessions s JOIN users u ON u.id::text = s.user_id
		WHERE s.session_key=$1 AND s.expire_date > NOW() AND u.is_active=TRUE
	)`, sessionKey).Scan(&authenticated)
	if err != nil {
		return "", fmt.Errorf("authenticate unsplash request: %w", err)
	}
	if !authenticated {
		return "", ErrUnauthorized
	}
	if !s.UseDatabaseKey {
		return strings.TrimSpace(s.FallbackKey), nil
	}
	var value string
	err = s.Pool.QueryRow(ctx, `SELECT COALESCE(value, '') FROM instance_configurations
		WHERE key='UNSPLASH_ACCESS_KEY' LIMIT 1`).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return strings.TrimSpace(s.FallbackKey), nil
	}
	if err != nil {
		return "", fmt.Errorf("read unsplash configuration: %w", err)
	}
	return strings.TrimSpace(value), nil
}
