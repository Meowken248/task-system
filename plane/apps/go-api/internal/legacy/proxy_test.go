package legacy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProxyFallbackReason(t *testing.T) {
	// 1. Create a dummy backend server (Django mock)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify that proxy correctly forwarded the request
		if r.Header.Get("X-Test-Header") != "test-value" {
			t.Errorf("Expected X-Test-Header, got %q", r.Header.Get("X-Test-Header"))
		}
		
		// Return some content
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("backend response"))
	}))
	defer backend.Close()

	// 2. Initialize the proxy handler
	proxyHandler, err := NewProxy(backend.URL)
	if err != nil {
		t.Fatalf("Failed to create proxy: %v", err)
	}

	// 3. Create a test request and inject fallback reason header
	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/some-legacy-endpoint", nil)
	req.Header.Set("X-Test-Header", "test-value")
	req.Header.Set("X-Plane-Fallback-Reason", "unsupported_endpoint")

	// 4. Record the response
	w := httptest.NewRecorder()
	proxyHandler.ServeHTTP(w, req)

	// 5. Verify the response
	res := w.Result()
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", res.StatusCode)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("Failed to read body: %v", err)
	}

	if string(body) != "backend response" {
		t.Errorf("Expected body 'backend response', got %q", string(body))
	}

	// Verify that X-Plane-Fallback-Reason was set in the response to the CLIENT
	if reason := res.Header.Get("X-Plane-Fallback-Reason"); reason != "unsupported_endpoint" {
		t.Errorf("Expected fallback reason 'unsupported_endpoint', got %q", reason)
	}
}

func TestProxyNoFallbackReason(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	proxyHandler, err := NewProxy(backend.URL)
	if err != nil {
		t.Fatalf("Failed to create proxy: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "http://localhost:8080/api/some-endpoint", nil)
	w := httptest.NewRecorder()
	
	proxyHandler.ServeHTTP(w, req)

	res := w.Result()
	if reason := res.Header.Get("X-Plane-Fallback-Reason"); reason != "unknown_or_unmatched_route" {
		t.Errorf("Expected fallback reason 'unknown_or_unmatched_route', got %q", reason)
	}
}
