package deployboard

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type storeStub struct {
	board DeployBoard
	err   error
}

func (s storeStub) GetProjectDeployBoard(context.Context, string, string, string) (DeployBoard, error) {
	return s.board, s.err
}

func (s storeStub) SaveProjectDeployBoard(context.Context, string, string, string, map[string]any) (DeployBoard, error) {
	return s.board, s.err
}

func TestProjectDeployBoardHandler_Get(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/project-deploy-boards/", nil)
	res := httptest.NewRecorder()
	ProjectDeployBoardHandler{Store: storeStub{
		board: DeployBoard{ID: "board-1", Anchor: "anch-1"},
	}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
	if !strings.Contains(res.Body.String(), "anch-1") {
		t.Errorf("response body does not contain expected data")
	}
}

func TestProjectDeployBoardHandler_GetEmpty(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/project-deploy-boards/", nil)
	res := httptest.NewRecorder()
	ProjectDeployBoardHandler{Store: storeStub{
		board: DeployBoard{},
	}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
	if strings.TrimSpace(res.Body.String()) != "{}" {
		t.Errorf("expected {}, got %s", res.Body.String())
	}
}

func TestProjectDeployBoardHandler_Post(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/project-deploy-boards/", strings.NewReader(`{"is_comments_enabled":true}`))
	res := httptest.NewRecorder()
	ProjectDeployBoardHandler{Store: storeStub{
		board: DeployBoard{ID: "board-1", IsCommentsEnabled: true},
	}}.ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200", res.Code)
	}
	if !strings.Contains(res.Body.String(), "board-1") {
		t.Errorf("response body does not contain expected data")
	}
}

func TestProjectDeployBoardHandler_Forbidden(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/project-deploy-boards/", nil)
	res := httptest.NewRecorder()
	ProjectDeployBoardHandler{Store: storeStub{err: ErrForbidden}}.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status=%d, want 403", res.Code)
	}
}
