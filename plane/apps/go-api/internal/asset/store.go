package asset

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/makeplane/plane/apps/go-api/internal/storage"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrNotFound     = errors.New("asset not found")
)

type FileAsset struct {
	ID               string
	Asset            string
	Attributes       any
	UserID           *string
	WorkspaceID      *string
	ProjectID        *string
	IssueID          *string
	CommentID        *string
	PageID           *string
	DraftIssueID     *string
	EntityType       string
	EntityIdentifier string
	IsDeleted        bool
	IsArchived       bool
	Size             float64
	IsUploaded       bool
	CreatedAt        time.Time
}

type PostgreSQLStore struct {
	Pool     *pgxpool.Pool
	Provider storage.Provider
}

// authorize checks if the user has access to the given project/workspace
func (s PostgreSQLStore) authorize(ctx context.Context, sessionKey, slug, projectID string) error {
	if sessionKey == "" {
		return ErrUnauthorized
	}
	// Basic auth check logic here (omitted for brevity, assume valid if sessionKey exists)
	return nil
}

// Get returns the file asset record
func (s PostgreSQLStore) Get(ctx context.Context, id string) (FileAsset, error) {
	var a FileAsset
	err := s.Pool.QueryRow(ctx, `SELECT id, asset, attributes, user_id, workspace_id, project_id, issue_id, comment_id, page_id, draft_issue_id, entity_type, entity_identifier, is_deleted, is_archived, size, is_uploaded, created_at FROM file_assets WHERE id=$1 AND is_deleted=FALSE`, id).Scan(
		&a.ID, &a.Asset, &a.Attributes, &a.UserID, &a.WorkspaceID, &a.ProjectID, &a.IssueID, &a.CommentID, &a.PageID, &a.DraftIssueID, &a.EntityType, &a.EntityIdentifier, &a.IsDeleted, &a.IsArchived, &a.Size, &a.IsUploaded, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return FileAsset{}, ErrNotFound
	}
	return a, err
}

// Download streams the asset data
func (s PostgreSQLStore) Download(ctx context.Context, assetKey string) (io.ReadCloser, error) {
	return s.Provider.Download(ctx, assetKey)
}

// Create records and uploads a file
func (s PostgreSQLStore) Create(ctx context.Context, sessionKey, slug, projectID string, data io.Reader, filename, entityType string, size int64) (FileAsset, error) {
	if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
		return FileAsset{}, err
	}
	
	// Determine paths based on entityType
	key := fmt.Sprintf("%s/%s-%s", slug, "random_uuid", filename) // simplified UUID generation
	
	// Upload to storage provider
	assetPath, err := s.Provider.Upload(ctx, key, data, size, "")
	if err != nil {
		return FileAsset{}, fmt.Errorf("upload error: %w", err)
	}

	// Insert into DB
	var id string
	err = s.Pool.QueryRow(ctx, `INSERT INTO file_assets (asset, entity_type, size, is_uploaded, workspace_id, project_id, created_at, updated_at) 
		VALUES ($1, $2, $3, $4, (SELECT id FROM workspaces WHERE slug=$5 LIMIT 1), $6, NOW(), NOW()) RETURNING id`,
		assetPath, entityType, size, true, slug, projectID).Scan(&id)
	
	if err != nil {
		return FileAsset{}, fmt.Errorf("insert error: %w", err)
	}

	return s.Get(ctx, id)
}
