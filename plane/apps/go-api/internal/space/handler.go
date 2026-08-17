package space

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/makeplane/plane/apps/go-api/internal/asset"
	"github.com/makeplane/plane/apps/go-api/internal/comment"
	"github.com/makeplane/plane/apps/go-api/internal/commentreaction"
	"github.com/makeplane/plane/apps/go-api/internal/issue"
	"github.com/makeplane/plane/apps/go-api/internal/reaction"
)

type Handler struct {
	Store      Store
	IssueStore interface {
		ListPublic(ctx context.Context, projectID string, filter issue.IssueFilter) (issue.Page, error)
		GetPublic(ctx context.Context, projectID, issueID, expand string) (issue.Item, error)
	}
	CommentStore interface {
		ListPublic(ctx context.Context, projectID, issueID string) ([]comment.Comment, error)
	}
	ReactionStore interface {
		ListPublic(ctx context.Context, projectID, issueID string) ([]reaction.ReactionItem, error)
	}
	CommentReactionStore interface {
		ListPublic(ctx context.Context, projectID, commentID string) ([]commentreaction.ReactionItem, error)
	}
	IntakeStore interface {
		ListPublic(ctx context.Context, projectID, intakeID string) ([]map[string]any, error)
		GetPublic(ctx context.Context, projectID, intakeID, pk string) (map[string]any, error)
		CreatePublic(ctx context.Context, projectID, intakeID, workspaceID string, issueData map[string]any, userID *string) (map[string]any, error)
		UpdatePublic(ctx context.Context, projectID, intakeID, pk string, issueData map[string]any, userID *string) (map[string]any, error)
		DeletePublic(ctx context.Context, projectID, intakeID, pk string, userID *string) error
	}
	AssetStore interface {
		GetPublic(ctx context.Context, pk, workspaceID string) (asset.FileAsset, error)
		CreatePresignedPublic(ctx context.Context, workspaceID, projectID, filename, fileType, entityType string, size int64, entityIdentifier, userID string) (asset.FileAsset, map[string]any, error)
		UpdatePublic(ctx context.Context, pk, workspaceID string, attributes map[string]any) error
		DeletePublic(ctx context.Context, pk, workspaceID, projectID string) error
		RestorePublic(ctx context.Context, pk, workspaceID string) error
	}
	mux *http.ServeMux
}

func NewHandler(store Store, issueStore interface {
	ListPublic(ctx context.Context, projectID string, filter issue.IssueFilter) (issue.Page, error)
	GetPublic(ctx context.Context, projectID, issueID, expand string) (issue.Item, error)
}, commentStore interface {
	ListPublic(ctx context.Context, projectID, issueID string) ([]comment.Comment, error)
}, reactionStore interface {
	ListPublic(ctx context.Context, projectID, issueID string) ([]reaction.ReactionItem, error)
}, commentReactionStore interface {
	ListPublic(ctx context.Context, projectID, commentID string) ([]commentreaction.ReactionItem, error)
}, intakeStore interface {
	ListPublic(ctx context.Context, projectID, intakeID string) ([]map[string]any, error)
	GetPublic(ctx context.Context, projectID, intakeID, pk string) (map[string]any, error)
	CreatePublic(ctx context.Context, projectID, intakeID, workspaceID string, issueData map[string]any, userID *string) (map[string]any, error)
	UpdatePublic(ctx context.Context, projectID, intakeID, pk string, issueData map[string]any, userID *string) (map[string]any, error)
	DeletePublic(ctx context.Context, projectID, intakeID, pk string, userID *string) error
}, assetStore interface {
	GetPublic(ctx context.Context, pk, workspaceID string) (asset.FileAsset, error)
	CreatePresignedPublic(ctx context.Context, workspaceID, projectID, filename, fileType, entityType string, size int64, entityIdentifier, userID string) (asset.FileAsset, map[string]any, error)
	UpdatePublic(ctx context.Context, pk, workspaceID string, attributes map[string]any) error
	DeletePublic(ctx context.Context, pk, workspaceID, projectID string) error
	RestorePublic(ctx context.Context, pk, workspaceID string) error
}) *Handler {
	h := &Handler{
		Store:                store,
		IssueStore:           issueStore,
		CommentStore:         commentStore,
		ReactionStore:        reactionStore,
		CommentReactionStore: commentReactionStore,
		IntakeStore:          intakeStore,
		AssetStore:           assetStore,
		mux:                  http.NewServeMux(),
	}

	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/meta/", h.ProjectMeta)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/settings/", h.ProjectSettings)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/members/", h.ProjectMembers)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/cycles/", h.ProjectCycles)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/modules/", h.ProjectModules)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/states/", h.ProjectStates)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/labels/", h.ProjectLabels)
	h.mux.HandleFunc("GET /api/public/workspaces/{slug}/projects/{project_id}/anchor/", h.WorkspaceProjectAnchor)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/issues/", h.ProjectIssues)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/issues/{issue_id}/", h.ProjectIssue)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/issues/{issue_id}/comments/", h.ProjectIssueComments)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/issues/{issue_id}/reactions/", h.ProjectIssueReactions)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/comments/{comment_id}/reactions/", h.ProjectCommentReactions)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/issues/{issue_id}/votes/", h.ProjectIssueVotes)

	h.mux.HandleFunc("GET /api/public/workspaces/{slug}/project-boards/", h.WorkspaceProjectBoards)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/intakes/{intake_id}/intake-issues/", h.ProjectIntakeIssues)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/intakes/{intake_id}/inbox-issues/", h.ProjectIntakeIssues)
	h.mux.HandleFunc("POST /api/public/anchor/{anchor}/intakes/{intake_id}/intake-issues/", h.CreateProjectIntakeIssue)
	h.mux.HandleFunc("GET /api/public/anchor/{anchor}/intakes/{intake_id}/intake-issues/{pk}/", h.GetProjectIntakeIssue)
	h.mux.HandleFunc("PATCH /api/public/anchor/{anchor}/intakes/{intake_id}/intake-issues/{pk}/", h.UpdateProjectIntakeIssue)
	h.mux.HandleFunc("DELETE /api/public/anchor/{anchor}/intakes/{intake_id}/intake-issues/{pk}/", h.DeleteProjectIntakeIssue)

	h.mux.HandleFunc("GET /api/public/assets/v2/anchor/{anchor}/{pk}/", h.GetProjectAsset)
	h.mux.HandleFunc("POST /api/public/assets/v2/anchor/{anchor}/", h.CreateProjectAsset)
	h.mux.HandleFunc("PATCH /api/public/assets/v2/anchor/{anchor}/{pk}/", h.UpdateProjectAsset)
	h.mux.HandleFunc("DELETE /api/public/assets/v2/anchor/{anchor}/{pk}/", h.DeleteProjectAsset)
	h.mux.HandleFunc("POST /api/public/assets/v2/anchor/{anchor}/restore/{pk}/", h.RestoreProjectAsset)

	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	h.mux.ServeHTTP(w, r)
}

func (h *Handler) ProjectMeta(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	meta, err := h.Store.GetProjectMeta(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(meta)
}

func (h *Handler) ProjectSettings(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	settings, err := h.Store.GetProjectSettings(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Not found"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(settings)
}

func (h *Handler) ProjectMembers(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	members, err := h.Store.GetProjectMembers(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(members)
}

func (h *Handler) ProjectCycles(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	cycles, err := h.Store.GetProjectCycles(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(cycles)
}

func (h *Handler) ProjectModules(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	modules, err := h.Store.GetProjectModules(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(modules)
}

func (h *Handler) ProjectStates(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	states, err := h.Store.GetProjectStates(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(states)
}

func (h *Handler) ProjectLabels(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	labels, err := h.Store.GetProjectLabels(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(labels)
}

func (h *Handler) WorkspaceProjectAnchor(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	projectID := r.PathValue("project_id")
	settings, err := h.Store.GetWorkspaceProjectAnchor(r.Context(), slug, projectID)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Not found"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(settings)
}

func (h *Handler) ProjectIssues(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	settings, err := h.Store.GetProjectSettings(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}

	projectID, _ := settings["project"].(string)

	filter := issue.IssueFilter{
		Limit:      100, // Default limit
		Offset:     0,
		State:      r.URL.Query().Get("state"),
		StateGroup: r.URL.Query().Get("state_group"),
		Priority:   r.URL.Query().Get("priority"),
		Labels:     r.URL.Query().Get("labels"),
		Assignees:  r.URL.Query().Get("assignees"),
		CreatedBy:  r.URL.Query().Get("created_by"),
		OrderBy:    r.URL.Query().Get("order_by"),
		GroupBy:    r.URL.Query().Get("group_by"),
		Expand:     r.URL.Query().Get("expand"),
	}

	page, err := h.IssueStore.ListPublic(r.Context(), projectID, filter)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(page)
}

func (h *Handler) ProjectIssue(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	issueID := r.PathValue("issue_id")
	expand := r.URL.Query().Get("expand")

	settings, err := h.Store.GetProjectSettings(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}

	projectID, _ := settings["project"].(string)

	item, err := h.IssueStore.GetPublic(r.Context(), projectID, issueID, expand)
	if err != nil {
		if err == issue.ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Issue not found"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(item)
}

func (h *Handler) ProjectIssueComments(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	issueID := r.PathValue("issue_id")

	settings, err := h.Store.GetProjectSettings(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}

	projectID, _ := settings["project"].(string)

	items, err := h.CommentStore.ListPublic(r.Context(), projectID, issueID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(items)
}

func (h *Handler) ProjectIssueReactions(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	issueID := r.PathValue("issue_id")

	settings, err := h.Store.GetProjectSettings(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}

	projectID, _ := settings["project"].(string)

	items, err := h.ReactionStore.ListPublic(r.Context(), projectID, issueID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(items)
}

func (h *Handler) ProjectCommentReactions(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	commentID := r.PathValue("comment_id")

	settings, err := h.Store.GetProjectSettings(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}

	projectID, _ := settings["project"].(string)

	items, err := h.CommentReactionStore.ListPublic(r.Context(), projectID, commentID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(items)
}

func (h *Handler) ProjectIssueVotes(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	issueID := r.PathValue("issue_id")

	settings, err := h.Store.GetProjectSettings(r.Context(), anchor)
	if err != nil {
		if err == ErrNotFound {
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{"error": "Invalid anchor"})
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}

	projectID, _ := settings["project"].(string)

	items, err := h.Store.GetProjectIssueVotes(r.Context(), projectID, issueID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(items)
}

func (h *Handler) WorkspaceProjectBoards(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	items, err := h.Store.GetWorkspaceProjectDeployBoards(r.Context(), slug)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "Internal server error"})
		return
	}
	json.NewEncoder(w).Encode(items)
}

func (h *Handler) getWorkspaceAndProjectFromAnchor(ctx context.Context, anchor string) (string, string, error) {
	settings, err := h.Store.GetProjectSettings(ctx, anchor)
	if err != nil {
		return "", "", err
	}
	projectID, _ := settings["project"].(string)
	workspaceID, _ := settings["workspace"].(string)
	return workspaceID, projectID, nil
}

func (h *Handler) ProjectIntakeIssues(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	intakeID := r.PathValue("intake_id")
	_, projectID, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}
	items, err := h.IntakeStore.ListPublic(r.Context(), projectID, intakeID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(items)
}

func (h *Handler) GetProjectIntakeIssue(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	intakeID := r.PathValue("intake_id")
	pk := r.PathValue("pk")
	_, projectID, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}
	item, err := h.IntakeStore.GetPublic(r.Context(), projectID, intakeID, pk)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Not found"})
		return
	}
	json.NewEncoder(w).Encode(item)
}

func (h *Handler) CreateProjectIntakeIssue(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	intakeID := r.PathValue("intake_id")
	workspaceID, projectID, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}

	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON"})
		return
	}

	item, err := h.IntakeStore.CreatePublic(r.Context(), projectID, intakeID, workspaceID, payload, nil)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(item)
}

func (h *Handler) UpdateProjectIntakeIssue(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	intakeID := r.PathValue("intake_id")
	pk := r.PathValue("pk")
	_, projectID, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}

	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON"})
		return
	}

	item, err := h.IntakeStore.UpdatePublic(r.Context(), projectID, intakeID, pk, payload, nil)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(item)
}

func (h *Handler) DeleteProjectIntakeIssue(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	intakeID := r.PathValue("intake_id")
	pk := r.PathValue("pk")
	_, projectID, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}
	if err := h.IntakeStore.DeletePublic(r.Context(), projectID, intakeID, pk, nil); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) GetProjectAsset(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	pk := r.PathValue("pk")
	workspaceID, _, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}
	assetItem, err := h.AssetStore.GetPublic(r.Context(), pk, workspaceID)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "The requested asset could not be found."})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"asset_url": assetItem.Asset})
}

func (h *Handler) CreateProjectAsset(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	workspaceID, projectID, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}

	var payload struct {
		Name             string `json:"name"`
		Type             string `json:"type"`
		Size             int64  `json:"size"`
		EntityType       string `json:"entity_type"`
		EntityIdentifier string `json:"entity_identifier"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid JSON"})
		return
	}

	assetItem, presigned, err := h.AssetStore.CreatePresignedPublic(r.Context(), workspaceID, projectID, payload.Name, payload.Type, payload.EntityType, payload.Size, payload.EntityIdentifier, "")
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"upload_data": presigned,
		"asset_id": assetItem.ID,
		"asset_url": assetItem.Asset,
	})
}

func (h *Handler) UpdateProjectAsset(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	pk := r.PathValue("pk")
	workspaceID, _, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}
	
	var payload struct {
		Attributes map[string]any `json:"attributes"`
	}
	json.NewDecoder(r.Body).Decode(&payload)

	err = h.AssetStore.UpdatePublic(r.Context(), pk, workspaceID, payload.Attributes)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteProjectAsset(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	pk := r.PathValue("pk")
	workspaceID, projectID, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}
	err = h.AssetStore.DeletePublic(r.Context(), pk, workspaceID, projectID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) RestoreProjectAsset(w http.ResponseWriter, r *http.Request) {
	anchor := r.PathValue("anchor")
	pk := r.PathValue("pk")
	workspaceID, _, err := h.getWorkspaceAndProjectFromAnchor(r.Context(), anchor)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Project is not published"})
		return
	}
	err = h.AssetStore.RestorePublic(r.Context(), pk, workspaceID)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
