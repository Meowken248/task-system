package favorite

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type storeStub struct {
	poolMock bool
}

func (s storeStub) ListForSession(ctx context.Context, sessionKey, slug string) ([]FavoriteItem, error) {
	return nil, nil
}
func (s storeStub) ListGroupForSession(ctx context.Context, sessionKey, slug, parentID string) ([]FavoriteItem, error) {
	return nil, nil
}
func (s storeStub) CreateForSession(ctx context.Context, sessionKey, slug string, input WritePayload) (FavoriteItem, error) {
	return FavoriteItem{}, nil
}
func (s storeStub) UpdateForSession(ctx context.Context, sessionKey, slug, favoriteID string, input WritePayload) (FavoriteItem, error) {
	return FavoriteItem{}, nil
}
func (s storeStub) DeleteForSession(ctx context.Context, sessionKey, slug, favoriteID string) error {
	return nil
}

func (s storeStub) ListProjectFavoritesForSession(ctx context.Context, sessionKey, slug, projectID, entityType string) ([]FavoriteItem, error) {
	if sessionKey == "unauth" {
		return nil, ErrUnauthorized
	}
	return []FavoriteItem{
		{
			ID:               "fav-1",
			EntityIdentifier: "ent-1",
			ProjectID:        &projectID,
		},
	}, nil
}

func (s storeStub) CreateProjectFavoriteForSession(ctx context.Context, sessionKey, slug, projectID, entityType, entityIdentifier string) error {
	if sessionKey == "unauth" {
		return ErrUnauthorized
	}
	return nil
}

func (s storeStub) DeleteProjectFavoriteForSession(ctx context.Context, sessionKey, slug, projectID, entityType, entityIdentifier string) error {
	if sessionKey == "unauth" {
		return ErrUnauthorized
	}
	if entityIdentifier == "missing" {
		return ErrNotFound
	}
	return nil
}

func (s storeStub) Available() bool { return s.poolMock }

func TestProjectFavoriteHandler_Get(t *testing.T) {
	handler := ProjectFavoriteHandler{
		Store:             storeStub{poolMock: true},
		SessionCookieName: "sessionid",
		EntityType:        "cycle",
	}

	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/test-slug/projects/test-proj/user-favorite-cycles/", nil)
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid-session"})
	req.SetPathValue("slug", "test-slug")
	req.SetPathValue("project_id", "test-proj")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var res []FavoriteItem
	json.NewDecoder(w.Body).Decode(&res)
	if len(res) != 1 || res[0].ID != "fav-1" {
		t.Errorf("unexpected response: %v", res)
	}
}

func TestProjectFavoriteHandler_Post(t *testing.T) {
	handler := ProjectFavoriteHandler{
		Store:             storeStub{poolMock: true},
		SessionCookieName: "sessionid",
		EntityType:        "cycle",
	}

	body := []byte(`{"cycle": "cycle-id-123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/test-slug/projects/test-proj/user-favorite-cycles/", bytes.NewReader(body))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid-session"})
	req.SetPathValue("slug", "test-slug")
	req.SetPathValue("project_id", "test-proj")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", w.Code)
	}
}

func TestProjectFavoriteHandler_Delete(t *testing.T) {
	handler := ProjectFavoriteHandler{
		Store:             storeStub{poolMock: true},
		SessionCookieName: "sessionid",
		EntityType:        "cycle",
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/workspaces/test-slug/projects/test-proj/user-favorite-cycles/cycle-id-123/", nil)
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid-session"})
	req.SetPathValue("slug", "test-slug")
	req.SetPathValue("project_id", "test-proj")
	req.SetPathValue("cycle_id", "cycle-id-123")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", w.Code)
	}
}

func TestProjectFavoriteHandler_DeleteNotFound(t *testing.T) {
	handler := ProjectFavoriteHandler{
		Store:             storeStub{poolMock: true},
		SessionCookieName: "sessionid",
		EntityType:        "module",
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/workspaces/test-slug/projects/test-proj/user-favorite-modules/missing/", nil)
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid-session"})
	req.SetPathValue("slug", "test-slug")
	req.SetPathValue("project_id", "test-proj")
	req.SetPathValue("module_id", "missing")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestProjectFavoriteHandler_Post_View(t *testing.T) {
	handler := ProjectFavoriteHandler{
		Store:             storeStub{poolMock: true},
		SessionCookieName: "sessionid",
		EntityType:        "view",
	}

	body := []byte(`{"view": "view-id-123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/workspaces/test-slug/projects/test-proj/user-favorite-views/", bytes.NewReader(body))
	req.AddCookie(&http.Cookie{Name: "sessionid", Value: "valid-session"})
	req.SetPathValue("slug", "test-slug")
	req.SetPathValue("project_id", "test-proj")

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", w.Code)
	}
}
