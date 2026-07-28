package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readinessStub struct{ err error }

func (s readinessStub) PingContext(context.Context) error { return s.err }

func TestLive(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Version: "test"}).ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
	if got := res.Header().Get("X-Plane-Backend"); got != "go" {
		t.Fatalf("X-Plane-Backend = %q", got)
	}
}

func TestReadyFailsWhenDatabaseIsUnavailable(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Readiness: readinessStub{err: errors.New("down")}}).ServeHTTP(res, req)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", res.Code)
	}
}

func TestUnknownRouteUsesLegacyFallback(t *testing.T) {
	legacy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/", nil)
	res := httptest.NewRecorder()
	NewRouter(Dependencies{Legacy: legacy}).ServeHTTP(res, req)
	if res.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want 418", res.Code)
	}
}
