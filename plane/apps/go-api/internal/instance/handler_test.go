package instance

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHandlerCachesInstanceResponse(t *testing.T) {
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/api/instances/" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"instance": map[string]any{"is_setup_done": true},
			"config":   map[string]any{},
		})
	}))
	defer upstream.Close()
	handler, err := NewHandler(upstream.URL, time.Minute)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	for range 2 {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/instances/", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d", response.Code)
		}
	}
	if requests != 1 {
		t.Fatalf("upstream requests = %d, want 1", requests)
	}
}

func TestHandlerServesStaleValueWhenUpstreamFails(t *testing.T) {
	healthy := true
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if !healthy {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"instance": map[string]any{},
			"config":   map[string]any{},
		})
	}))
	defer upstream.Close()
	handler, err := NewHandler(upstream.URL, 0)
	if err != nil {
		t.Fatalf("NewHandler() error = %v", err)
	}
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/instances/", nil))
	healthy = false
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/instances/", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if response.Header().Get("X-Plane-Instance-Stale") != "true" {
		t.Fatal("expected stale response header")
	}
}

func TestHandlerRejectsInvalidUpstreamPayload(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("not-json"))
	}))
	defer upstream.Close()
	handler, _ := NewHandler(upstream.URL, time.Minute)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/instances/", nil))
	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.Code)
	}
}
