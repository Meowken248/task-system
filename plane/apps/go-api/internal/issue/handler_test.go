package issue

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type readerStub struct{ err error }

func (s readerStub) ListForSession(context.Context, string, string, string, IssueFilter) (Page, error) {
	return Page{Results: []Item{{ID: "issue-1", Name: "Test"}}}, s.err
}
func (s readerStub) GetForSession(context.Context, string, string, string, string, string) (Item, error) {
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

type writerStub struct {
	readerStub
	created WritePayload
	updated WritePayload
	deleted bool
	err     error
}

func (s *writerStub) CreateForSession(_ context.Context, _, _, _ string, payload WritePayload) (Item, error) {
	s.created = payload
	return Item{ID: "created", Name: valueOr(payload.Name, "")}, s.err
}

func (s *writerStub) UpdateForSession(_ context.Context, _, _, _, _ string, payload WritePayload) (Item, error) {
	s.updated = payload
	return Item{ID: "updated", Name: valueOr(payload.Name, "")}, s.err
}

func (s *writerStub) DeleteForSession(context.Context, string, string, string, string) error {
	s.deleted = true
	return s.err
}

func TestWriteMethods(t *testing.T) {
	for _, test := range []struct {
		method string
		body   string
		want   int
	}{
		{method: http.MethodPost, body: `{"name":"Created","unknown_frontend_field":true}`, want: http.StatusCreated},
		{method: http.MethodPatch, body: `{"name":"Updated"}`, want: http.StatusOK},
		{method: http.MethodDelete, want: http.StatusNoContent},
	} {
		store := &writerStub{}
		req := httptest.NewRequest(test.method, "/issues/issue-1/", strings.NewReader(test.body))
		req.SetPathValue("issue_id", "issue-1")
		res := httptest.NewRecorder()
		Handler{Store: store}.ServeHTTP(res, req)
		if res.Code != test.want {
			t.Fatalf("%s status=%d, want %d; body=%s", test.method, res.Code, test.want, res.Body.String())
		}
	}
}

func TestInvalidWritePayload(t *testing.T) {
	res := httptest.NewRecorder()
	Handler{Store: &writerStub{}}.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/issues/", strings.NewReader("{")))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", res.Code)
	}
}

func TestWriteErrorMapping(t *testing.T) {
	res := httptest.NewRecorder()
	store := &writerStub{err: ErrInvalid}
	Handler{Store: store}.ServeHTTP(res, httptest.NewRequest(http.MethodPost, "/issues/", strings.NewReader(`{"name":"x"}`)))
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, want 400", res.Code)
	}
}
