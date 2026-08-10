package external

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type keyStoreStub struct {
	key string
	err error
}

func (s keyStoreStub) AccessKeyForSession(context.Context, string) (string, error) {
	return s.key, s.err
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestUnsplashWithoutConfigurationReturnsEmptyList(t *testing.T) {
	handler := UnsplashHandler{Store: keyStoreStub{}, SessionCookieName: "sid"}
	request := httptest.NewRequest(http.MethodGet, "/api/unsplash/", nil)
	request.AddCookie(&http.Cookie{Name: "sid", Value: "session"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != "[]" {
		t.Fatalf("status/body = %d %q", response.Code, response.Body.String())
	}
}

func TestUnsplashProxiesProviderResponse(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Query().Get("query") != "office" || request.URL.Query().Get("page") != "$2" {
			t.Fatalf("unexpected query: %s", request.URL.RawQuery)
		}
		return &http.Response{StatusCode: http.StatusAccepted, Body: io.NopCloser(strings.NewReader(`{"results":[]}`)), Header: make(http.Header)}, nil
	})}
	handler := UnsplashHandler{Store: keyStoreStub{key: "key"}, SessionCookieName: "sid", Client: client}
	request := httptest.NewRequest(http.MethodGet, "/api/unsplash/?query=office&page=2", nil)
	request.AddCookie(&http.Cookie{Name: "sid", Value: "session"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || strings.TrimSpace(response.Body.String()) != `{"results":[]}` {
		t.Fatalf("status/body = %d %q", response.Code, response.Body.String())
	}
}
