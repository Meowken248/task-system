package projectmember

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type readerStub struct {
	items []Membership
	err   error
}

func (s readerStub) ListForSession(context.Context, string, string, string) ([]Membership, error) {
	return s.items, s.err
}

func TestList(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/members/", nil)
	res := httptest.NewRecorder()
	Handler{Store: readerStub{items: []Membership{{ID: "member-1", Member: "user-1", Role: 20, OriginalRole: 20}}}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
}

func TestUnauthorized(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/members/", nil)
	res := httptest.NewRecorder()
	Handler{Store: readerStub{err: ErrUnauthorized}}.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", res.Code)
	}
}
