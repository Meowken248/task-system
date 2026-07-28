package tracking

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	record map[string]any
	err    error
}

func (s storeStub) List(context.Context, string, string, string) ([]map[string]any, error) {
	if s.record == nil {
		return nil, s.err
	}
	return []map[string]any{s.record}, s.err
}

func (s storeStub) RecordOffline(_ context.Context, session, _, _ string, payload map[string]any) (map[string]any, error) {
	if session == "" {
		return nil, ErrUnauthorized
	}
	return payload, s.err
}

func (s storeStub) RecordVerified(_ context.Context, session, _, _ string, payload map[string]any) (map[string]any, error) {
	if session == "" {
		return nil, ErrUnauthorized
	}
	return payload, s.err
}

type verifierStub struct {
	metadata map[string]any
	err      error
}

func (v verifierStub) Verify(context.Context, map[string]any) (map[string]any, error) {
	return v.metadata, v.err
}

func TestOfflinePostUsesGoStore(t *testing.T) {
	handler := Handler{Store: storeStub{}, SessionCookieName: "sessionid"}
	req := httptest.NewRequest(http.MethodPost, "/tracking", strings.NewReader(`{"event_type":"create_task","issue_id":"issue","client_event_id":"client","on_chain":false}`))
	req.SetPathValue("slug", "workspace")
	req.SetPathValue("project_id", "project")
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session"})
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
}

func TestOnChainPostUsesVerifierAndGoStore(t *testing.T) {
	handler := Handler{Store: storeStub{}, Verifier: verifierStub{metadata: map[string]any{"on_chain_task_id": uint64(7)}}, SessionCookieName: "sessionid"}
	req := httptest.NewRequest(http.MethodPost, "/tracking", strings.NewReader(`{"event_type":"create_task","issue_id":"issue","transaction_hash":"0xhash","on_chain":true}`))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session"})
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	var record map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &record); err != nil || record["on_chain_task_id"] != float64(7) {
		t.Fatalf("record = %#v, err = %v", record, err)
	}
}

func TestGetUsesGoStore(t *testing.T) {
	handler := Handler{Store: storeStub{record: map[string]any{"client_event_id": "go"}}}
	req := httptest.NewRequest(http.MethodGet, "/tracking", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d", res.Code)
	}
	var records []map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &records); err != nil || len(records) != 1 {
		t.Fatalf("records = %#v, err = %v", records, err)
	}
}
func TestOnChainPostWithoutVerifierDoesNotFallback(t *testing.T) {
	handler := Handler{Store: storeStub{}, SessionCookieName: "sessionid"}
	req := httptest.NewRequest(http.MethodPost, "/tracking", strings.NewReader(`{"event_type":"create_task","issue_id":"issue","transaction_hash":"0xhash"}`))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session"})
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
}
