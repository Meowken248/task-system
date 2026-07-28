package issue

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readerStub struct{ err error }

func (s readerStub) ListForSession(context.Context, string, string, string, int, int) (Page, error) {
	return Page{Results: []Item{{ID: "issue-1", Name: "Test"}}}, s.err
}
func (s readerStub) GetForSession(context.Context, string, string, string, string) (Item, error) {
	return Item{ID: "issue-1", Name: "Test"}, s.err
}

func TestList(t *testing.T) {
	res := httptest.NewRecorder()
	Handler{Store: readerStub{}}.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/issues/", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}
func TestInvalidCursor(t *testing.T) {
	res := httptest.NewRecorder()
	Handler{Store: readerStub{}}.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/issues/?cursor=bad", nil))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", res.Code)
	}
}
func TestNotFound(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/issues/issue-1/", nil)
	req.SetPathValue("issue_id", "issue-1")
	res := httptest.NewRecorder()
	Handler{Store: readerStub{err: ErrNotFound}}.ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status=%d, want 404", res.Code)
	}
}
