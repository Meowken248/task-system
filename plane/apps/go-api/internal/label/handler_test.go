package label

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readerStub struct{ err error }

func (s readerStub) ListForSession(context.Context, string, string, string) ([]Item, error) {
	return []Item{{ID: "label-1", Name: "Bug"}}, s.err
}
func (s readerStub) GetForSession(context.Context, string, string, string, string) (Item, error) {
	return Item{ID: "label-1", Name: "Bug"}, s.err
}

func TestList(t *testing.T) {
	res := httptest.NewRecorder()
	Handler{Store: readerStub{}}.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/labels/", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestNotFound(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/labels/label-1/", nil)
	req.SetPathValue("label_id", "label-1")
	res := httptest.NewRecorder()
	Handler{Store: readerStub{err: ErrNotFound}}.ServeHTTP(res, req)
	if res.Code != http.StatusNotFound {
		t.Fatalf("status=%d, want 404", res.Code)
	}
}
