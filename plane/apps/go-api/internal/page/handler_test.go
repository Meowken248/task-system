package page

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type pageStoreStub struct {
	operation string
	action    string
	pageID    string
	payload   WritePayload
	err       error
}

func (s *pageStoreStub) List(context.Context, string, string, string) ([]Item, error) {
	s.operation = "list"
	return []Item{{ID: "page-1"}}, s.err
}
func (s *pageStoreStub) Summary(context.Context, string, string, string) (Summary, error) {
	s.operation = "summary"
	return Summary{PublicPages: 1}, s.err
}
func (s *pageStoreStub) Create(_ context.Context, _, _, _ string, payload WritePayload) (Item, error) {
	s.operation, s.payload = "create", payload
	return Item{ID: "page-created"}, s.err
}
func (s *pageStoreStub) Get(_ context.Context, _, _, _, pageID string) (Item, error) {
	s.operation, s.pageID = "get", pageID
	return Item{ID: pageID}, s.err
}
func (s *pageStoreStub) Update(_ context.Context, _, _, _, pageID string, payload WritePayload) (Item, error) {
	s.operation, s.pageID, s.payload = "update", pageID, payload
	return Item{ID: pageID}, s.err
}
func (s *pageStoreStub) Action(_ context.Context, _, _, _, pageID, action string, payload WritePayload) (any, error) {
	s.operation, s.pageID, s.action, s.payload = "action", pageID, action, payload
	if action == "description:GET" {
		return BinaryPayload{Data: []byte("page-description")}, s.err
	}
	return map[string]string{"ok": "true"}, s.err
}

func pageRequest(t *testing.T, store Store, method, action, body string) (*httptest.ResponseRecorder, *pageStoreStub) {
	t.Helper()
	stub, _ := store.(*pageStoreStub)
	req := httptest.NewRequest(method, "/", strings.NewReader(body))
	req.SetPathValue("slug", "demo")
	req.SetPathValue("project_id", "project-1")
	req.SetPathValue("page_id", "page-1")
	req.SetPathValue("page_action", action)
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-key"})
	res := httptest.NewRecorder()
	Handler{Store: store}.ServeHTTP(res, req)
	return res, stub
}

func TestPageCreateAndUpdate(t *testing.T) {
	store := &pageStoreStub{}
	res, _ := pageRequest(t, store, http.MethodPost, "", `{"name":"Roadmap"}`)
	if res.Code != http.StatusCreated || store.operation != "create" || store.payload.Name == nil || *store.payload.Name != "Roadmap" {
		t.Fatalf("create status=%d operation=%q body=%s", res.Code, store.operation, res.Body.String())
	}
	res, _ = pageRequest(t, store, http.MethodPatch, "", `{"color":"blue"}`)
	if res.Code != http.StatusOK || store.operation != "update" || !store.payload.has("color") {
		t.Fatalf("update status=%d operation=%q body=%s", res.Code, store.operation, res.Body.String())
	}
}

func TestPageActionsAndBinaryDescription(t *testing.T) {
	store := &pageStoreStub{}
	res, _ := pageRequest(t, store, http.MethodPost, "archive", "")
	if res.Code != http.StatusOK || store.action != "archive:POST" {
		t.Fatalf("archive status=%d action=%q", res.Code, store.action)
	}
	res, _ = pageRequest(t, store, http.MethodGet, "description", "")
	if res.Code != http.StatusOK || res.Body.String() != "page-description" || res.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("description status=%d type=%q body=%q", res.Code, res.Header().Get("Content-Type"), res.Body.String())
	}
}

func TestPageVersionPathAndErrorMapping(t *testing.T) {
	store := &pageStoreStub{}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetPathValue("slug", "demo")
	req.SetPathValue("project_id", "project-1")
	req.SetPathValue("page_id", "page-1")
	req.SetPathValue("page_action", "version")
	req.SetPathValue("version_id", "version-1")
	res := httptest.NewRecorder()
	Handler{Store: store}.ServeHTTP(res, req)
	if res.Code != http.StatusOK || store.action != "version:GET" || store.payload.Parent == nil || *store.payload.Parent != "version-1" {
		t.Fatalf("version status=%d action=%q payload=%+v", res.Code, store.action, store.payload)
	}
	store.err = errors.Join(ErrInvalid, errors.New("invalid request"))
	res, _ = pageRequest(t, store, http.MethodPost, "access", `{"access":1}`)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("invalid status=%d want=%d", res.Code, http.StatusBadRequest)
	}
}
