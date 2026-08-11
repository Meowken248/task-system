package analytic

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type storeStub struct {
	views []AnalyticView
	stats []map[string]any
	err   error
}

func (s storeStub) ListForSession(context.Context, string, string) ([]AnalyticView, error) {
	return s.views, s.err
}

func (s storeStub) ProjectStatsForSession(context.Context, string, string, []string, []string) ([]map[string]any, error) {
	return s.stats, s.err
}

func TestList(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/analytics/", nil)
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session"})
	res := httptest.NewRecorder()
	Handler{Store: storeStub{views: []AnalyticView{{ID: "view1"}}}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d", res.Code)
	}
}

func TestProjectStats(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/project-stats/", nil)
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session"})
	res := httptest.NewRecorder()
	ProjectStatsHandler{Store: storeStub{stats: []map[string]any{{"id": "project1"}}}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d", res.Code)
	}
}
