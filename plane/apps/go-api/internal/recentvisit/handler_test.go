package recentvisit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readerStub struct {
	payload []map[string]any
	err     error
}

func (s readerStub) ListForSession(ctx context.Context, sessionKey, slug, entityName string) ([]map[string]any, error) {
	return s.payload, s.err
}

func TestListRecentVisits(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/recentvisits/", nil)
	req.SetPathValue("slug", "demo")
	res := httptest.NewRecorder()
	
	Handler{Store: readerStub{payload: []map[string]any{{"id": "test"}}}}.ServeHTTP(res, req)
	
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestRecentVisitsErrors(t *testing.T) {
	tests := []struct {
		err  error
		want int
	}{
		{ErrUnauthorized, http.StatusUnauthorized},
		{ErrForbidden, http.StatusForbidden},
		{ErrNotFound, http.StatusNotFound},
	}
	
	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, "/recentvisits/", nil)
		res := httptest.NewRecorder()
		Handler{Store: readerStub{err: tc.err}}.ServeHTTP(res, req)
		if res.Code != tc.want {
			t.Fatalf("err=%v status=%d, want %d", tc.err, res.Code, tc.want)
		}
	}
}

func TestMethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/recentvisits/", nil)
	res := httptest.NewRecorder()
	
	Handler{Store: readerStub{}}.ServeHTTP(res, req)
	
	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d, want 405", res.Code)
	}
}
