package estimate

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	lastOperation string
	lastProjectID string
	lastEstimate  string
	lastPoint     string
	lastPayload   WritePayload
	lastPoints    []EstimatePointInput
	err           error
}

func (s *storeStub) capture(operation, projectID, estimateID, pointID string) {
	s.lastOperation = operation
	s.lastProjectID = projectID
	s.lastEstimate = estimateID
	s.lastPoint = pointID
}

func (s *storeStub) ListWorkspaceForSession(context.Context, string, string) ([]Estimate, error) {
	s.capture("workspace-list", "", "", "")
	return []Estimate{{ID: "estimate-1"}}, s.err
}
func (s *storeStub) ListForSession(_ context.Context, _, _, projectID string) ([]Estimate, error) {
	s.capture("list", projectID, "", "")
	return []Estimate{{ID: "estimate-1"}}, s.err
}
func (s *storeStub) GetForSession(_ context.Context, _, _, projectID, estimateID string) (Estimate, error) {
	s.capture("get", projectID, estimateID, "")
	return Estimate{ID: estimateID}, s.err
}
func (s *storeStub) CreateForSession(_ context.Context, _, _, projectID string, payload WritePayload) (Estimate, error) {
	s.capture("create", projectID, "", "")
	s.lastPayload = payload
	return Estimate{ID: "estimate-created"}, s.err
}
func (s *storeStub) UpdateForSession(_ context.Context, _, _, projectID, estimateID string, payload WritePayload) (Estimate, error) {
	s.capture("update", projectID, estimateID, "")
	s.lastPayload = payload
	return Estimate{ID: estimateID}, s.err
}
func (s *storeStub) DeleteForSession(_ context.Context, _, _, projectID, estimateID string) error {
	s.capture("delete", projectID, estimateID, "")
	return s.err
}
func (s *storeStub) ListPointsForSession(_ context.Context, _, _, projectID, estimateID string) ([]EstimatePoint, error) {
	s.capture("point-list", projectID, estimateID, "")
	return []EstimatePoint{{ID: "point-1", Key: 1}}, s.err
}
func (s *storeStub) CreatePointsForSession(_ context.Context, _, _, projectID, estimateID string, inputs []EstimatePointInput) ([]EstimatePoint, error) {
	s.capture("point-create", projectID, estimateID, "")
	s.lastPoints = inputs
	return []EstimatePoint{{ID: "point-created", Key: 1}}, s.err
}
func (s *storeStub) UpdatePointForSession(_ context.Context, _, _, projectID, estimateID, pointID string, input EstimatePointInput) (EstimatePoint, error) {
	s.capture("point-update", projectID, estimateID, pointID)
	s.lastPoints = []EstimatePointInput{input}
	return EstimatePoint{ID: pointID}, s.err
}
func (s *storeStub) DeletePointForSession(_ context.Context, _, _, projectID, estimateID, pointID string) error {
	s.capture("point-delete", projectID, estimateID, pointID)
	return s.err
}
func (s *storeStub) ListProjectPointsForSession(_ context.Context, _, _, projectID string) ([]EstimatePoint, error) {
	s.capture("project-points", projectID, "", "")
	return []EstimatePoint{{ID: "project-point-1", Key: 1}}, s.err
}

func estimateMux(store Store) http.Handler {
	mux := http.NewServeMux()
	handler := Handler{Store: store, SessionCookieName: "sessionid"}
	mux.Handle("/api/workspaces/{slug}/estimates/", handler)
	mux.Handle("/api/workspaces/{slug}/projects/{project_id}/estimates/", handler)
	mux.Handle("/api/workspaces/{slug}/projects/{project_id}/estimates/{estimate_id}/", handler)
	mux.Handle("/api/workspaces/{slug}/projects/{project_id}/estimates/{estimate_id}/estimate-points/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("estimate_points", "true")
		handler.ServeHTTP(w, r)
	}))
	mux.Handle("/api/workspaces/{slug}/projects/{project_id}/estimates/{estimate_id}/estimate-points/{estimate_point_id}/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("estimate_points", "true")
		handler.ServeHTTP(w, r)
	}))
	mux.Handle("/api/workspaces/{slug}/projects/{project_id}/project-estimates/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("project_estimates", "true")
		handler.ServeHTTP(w, r)
	}))
	return mux
}

func estimateRequest(t *testing.T, handler http.Handler, method, path, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if authenticated {
		req.AddCookie(&http.Cookie{Name: "sessionid", Value: "session-key"})
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

func TestEstimateRequiresSession(t *testing.T) {
	res := estimateRequest(t, estimateMux(&storeStub{}), http.MethodGet, "/api/workspaces/demo/projects/project-1/estimates/", "", false)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d want=%d", res.Code, http.StatusUnauthorized)
	}
}

func TestWorkspaceAndProjectEstimateReads(t *testing.T) {
	store := &storeStub{}
	handler := estimateMux(store)
	res := estimateRequest(t, handler, http.MethodGet, "/api/workspaces/demo/estimates/", "", true)
	if res.Code != http.StatusOK || store.lastOperation != "workspace-list" {
		t.Fatalf("workspace list status=%d operation=%q", res.Code, store.lastOperation)
	}
	res = estimateRequest(t, handler, http.MethodGet, "/api/workspaces/demo/projects/project-1/estimates/estimate-1/", "", true)
	if res.Code != http.StatusOK || store.lastOperation != "get" || store.lastEstimate != "estimate-1" {
		t.Fatalf("detail status=%d operation=%q estimate=%q", res.Code, store.lastOperation, store.lastEstimate)
	}
}

func TestEstimateCreateUpdateDelete(t *testing.T) {
	store := &storeStub{}
	handler := estimateMux(store)
	payload := `{"estimate":{"name":"Points","type":"points"},"estimate_points":[{"key":1,"value":"1"}]}`
	res := estimateRequest(t, handler, http.MethodPost, "/api/workspaces/demo/projects/project-1/estimates/", payload, true)
	if res.Code != http.StatusCreated || store.lastOperation != "create" || store.lastPayload.Estimate == nil {
		t.Fatalf("create status=%d operation=%q body=%s", res.Code, store.lastOperation, res.Body.String())
	}
	res = estimateRequest(t, handler, http.MethodPatch, "/api/workspaces/demo/projects/project-1/estimates/estimate-1/", `{"estimate":{"name":"Renamed"}}`, true)
	if res.Code != http.StatusOK || store.lastOperation != "update" {
		t.Fatalf("update status=%d operation=%q", res.Code, store.lastOperation)
	}
	res = estimateRequest(t, handler, http.MethodDelete, "/api/workspaces/demo/projects/project-1/estimates/estimate-1/", "", true)
	if res.Code != http.StatusNoContent || store.lastOperation != "delete" {
		t.Fatalf("delete status=%d operation=%q", res.Code, store.lastOperation)
	}
}

func TestEstimatePointMutations(t *testing.T) {
	store := &storeStub{}
	handler := estimateMux(store)
	base := "/api/workspaces/demo/projects/project-1/estimates/estimate-1/estimate-points/"
	res := estimateRequest(t, handler, http.MethodPost, base, `{"key":1,"value":"Small"}`, true)
	if res.Code != http.StatusOK || store.lastOperation != "point-create" || len(store.lastPoints) != 1 {
		t.Fatalf("point create status=%d operation=%q body=%s", res.Code, store.lastOperation, res.Body.String())
	}
	res = estimateRequest(t, handler, http.MethodPatch, base+"point-1/", `{"value":"Medium"}`, true)
	if res.Code != http.StatusOK || store.lastOperation != "point-update" || store.lastPoint != "point-1" {
		t.Fatalf("point update status=%d operation=%q point=%q", res.Code, store.lastOperation, store.lastPoint)
	}
	res = estimateRequest(t, handler, http.MethodDelete, base+"point-1/", "", true)
	if res.Code != http.StatusOK || store.lastOperation != "point-list" {
		t.Fatalf("point delete status=%d operation=%q body=%s", res.Code, store.lastOperation, res.Body.String())
	}
}

func TestEstimateErrorMapping(t *testing.T) {
	store := &storeStub{err: ErrInvalid}
	res := estimateRequest(t, estimateMux(store), http.MethodPost, "/api/workspaces/demo/projects/project-1/estimates/", `{"estimate":{"name":"Points"}}`, true)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("invalid status=%d body=%s", res.Code, res.Body.String())
	}
	store.err = errors.New("database down")
	res = estimateRequest(t, estimateMux(store), http.MethodGet, "/api/workspaces/demo/projects/project-1/estimates/", "", true)
	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("storage status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestProjectEstimates(t *testing.T) {
	store := &storeStub{}
	handler := estimateMux(store)
	res := estimateRequest(t, handler, http.MethodGet, "/api/workspaces/demo/projects/project-1/project-estimates/", "", true)
	if res.Code != http.StatusOK || store.lastOperation != "project-points" || store.lastProjectID != "project-1" {
		t.Fatalf("project estimates status=%d operation=%q body=%s", res.Code, store.lastOperation, res.Body.String())
	}
}
