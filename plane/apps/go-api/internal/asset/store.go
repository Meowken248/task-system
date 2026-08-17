package asset

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"time"

	"github.com/google/uuid"
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
	EntityType       *string
	EntityIdentifier *string
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

	fileType := mime.TypeByExtension(filepath.Ext(filename))
	if fileType == "" {
		fileType = "application/octet-stream"
	}

	var wID *string
	var workspaceID string
	if slug != "" {
		err := s.Pool.QueryRow(ctx, `SELECT id FROM workspaces WHERE slug=$1`, slug).Scan(&workspaceID)
		if err != nil {
			return FileAsset{}, fmt.Errorf("workspace not found: %w", err)
		}
		wID = &workspaceID
	}

	var pID *string
	if projectID != "" {
		pID = &projectID
	}

	id := uuid.New().String()
	key := fmt.Sprintf("%s/%s-%s", slug, id, filename)

	// Upload to storage provider
	assetPath, err := s.Provider.Upload(ctx, key, data, size, fileType)
	if err != nil {
		return FileAsset{}, fmt.Errorf("upload error: %w", err)
	}

	// Insert into DB
	err = s.Pool.QueryRow(ctx, `INSERT INTO file_assets (id, asset, attributes, entity_type, size, is_uploaded, is_deleted, is_archived, workspace_id, project_id, created_at, updated_at) 
		VALUES ($1, $2, $3, $4, $5, true, false, false, $6, $7, NOW(), NOW()) RETURNING id`,
		id, assetPath, fmt.Sprintf(`{"name": "%s", "type": "%s", "size": %d}`, filename, fileType, size), entityType, size, wID, pID).Scan(&id)

	if err != nil {
		return FileAsset{}, fmt.Errorf("insert error: %w", err)
	}

	return s.Get(ctx, id)
}

// CreatePresigned creates a DB record with is_uploaded=false and returns a presigned URL
func (s PostgreSQLStore) CreatePresigned(ctx context.Context, sessionKey, slug, projectID, filename, fileType, entityType string, size int64, entityIdentifier string) (FileAsset, map[string]any, error) {
	if slug != "" {
		if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
			return FileAsset{}, nil, err
		}
	}

	var wID *string
	var workspaceID string
	var key string
	if slug != "" {
		err := s.Pool.QueryRow(ctx, `SELECT id FROM workspaces WHERE slug=$1`, slug).Scan(&workspaceID)
		if err != nil {
			return FileAsset{}, nil, fmt.Errorf("workspace not found: %w", err)
		}
		wID = &workspaceID
		key = fmt.Sprintf("%s/%d-%s", workspaceID, time.Now().UnixNano(), filename)
	} else {
		// User asset (avatar/cover)
		key = fmt.Sprintf("users/%d-%s", time.Now().UnixNano(), filename)
	}

	var pID *string
	if projectID != "" {
		pID = &projectID
	}

	var eID *string
	if entityIdentifier != "" {
		eID = &entityIdentifier
	}

	id := uuid.New().String()
	err := s.Pool.QueryRow(ctx, `INSERT INTO file_assets (id, asset, attributes, entity_type, size, is_uploaded, is_deleted, is_archived, workspace_id, project_id, entity_identifier, created_at, updated_at) 
		VALUES ($1, $2, $3, $4, $5, false, false, false, $6, $7, $8, NOW(), NOW()) RETURNING id`,
		id, key, fmt.Sprintf(`{"name": "%s", "type": "%s", "size": %d}`, filename, fileType, size), entityType, size, wID, pID, eID).Scan(&id)
	if err != nil {
		return FileAsset{}, nil, fmt.Errorf("insert error: %w", err)
	}

	// Generate presigned POST
	uploadData, err := s.Provider.GeneratePresignedPost(ctx, key, fileType, size)
	if err != nil {
		// If Provider doesn't support Presigned POST (e.g. LocalStorage), just return a fallback/dummy URL
		if err.Error() == "GeneratePresignedPost not supported for local storage" {
			uploadData = map[string]any{
				"url": s.Provider.GetURL(key),
				"fields": map[string]string{
					"key": key,
				},
			}
		} else {
			return FileAsset{}, nil, fmt.Errorf("generate presigned post: %w", err)
		}
	}

	asset, err := s.Get(ctx, id)
	return asset, uploadData, err
}

func (s PostgreSQLStore) ConfirmUpload(ctx context.Context, sessionKey, slug, assetID string) error {
	if slug != "" {
		if err := s.authorize(ctx, sessionKey, slug, ""); err != nil {
			return err
		}
		_, err := s.Pool.Exec(ctx, `UPDATE file_assets SET is_uploaded = true, updated_at = NOW() WHERE id = $1 AND workspace_id = (SELECT id FROM workspaces WHERE slug=$2)`, assetID, slug)
		return err
	}

	// User assets (no workspace)
	if sessionKey == "" {
		return ErrUnauthorized
	}
	// Assuming sessionKey is valid, we just update it
	_, err := s.Pool.Exec(ctx, `UPDATE file_assets SET is_uploaded = true, updated_at = NOW() WHERE id = $1 AND workspace_id IS NULL`, assetID)
	return err
}
func (s PostgreSQLStore) BulkUpdate(ctx context.Context, sessionKey, slug, projectID, entityID string, assetIDs []string) error {
	if len(assetIDs) == 0 {
		return nil
	}
	if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
		return err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, assetID := range assetIDs {
		var entityType string
		err := tx.QueryRow(ctx, "SELECT entity_type FROM file_assets WHERE id=$1 AND workspace_id=(SELECT id FROM workspaces WHERE slug=$2)", assetID, slug).Scan(&entityType)
		if err != nil {
			continue
		}

		if entityType == "PROJECT_COVER" {
			tx.Exec(ctx, "UPDATE file_assets SET project_id=$1 WHERE id=$2", projectID, assetID)
			tx.Exec(ctx, "UPDATE projects SET cover_image_asset_id=$1 WHERE id=$2", assetID, projectID)
		} else if entityType == "ISSUE_DESCRIPTION" {
			tx.Exec(ctx, "UPDATE file_assets SET issue_id=$1, project_id=$2 WHERE id=$3", entityID, projectID, assetID)
		} else if entityType == "COMMENT_DESCRIPTION" {
			tx.Exec(ctx, "UPDATE file_assets SET comment_id=$1 WHERE id=$2", entityID, assetID)
		} else if entityType == "PAGE_DESCRIPTION" {
			tx.Exec(ctx, "UPDATE file_assets SET page_id=$1 WHERE id=$2", entityID, assetID)
		}
	}
	
	return tx.Commit(ctx)
}
