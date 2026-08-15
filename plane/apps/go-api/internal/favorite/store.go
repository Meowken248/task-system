package favorite

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("workspace access denied")
	ErrNotFound     = errors.New("favorite not found")
	ErrInvalid      = errors.New("invalid favorite")
	ErrConflict     = errors.New("favorite already exists")
)

type FavoriteItem struct {
	ID               string          `json:"id"`
	WorkspaceID      string          `json:"workspace"`
	ProjectID        *string         `json:"project"`
	ParentID         *string         `json:"parent"`
	EntityType       string          `json:"entity_type"`
	EntityIdentifier *string         `json:"entity_identifier"`
	Sequence         float64         `json:"sequence"`
	Name             string          `json:"name"`
	IsFolder         bool            `json:"is_folder"`
	Metadata         json.RawMessage `json:"metadata"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	CreatedBy        *string         `json:"created_by"`
	UpdatedBy        *string         `json:"updated_by"`
}

type WritePayload struct {
	EntityType       *string         `json:"entity_type"`
	EntityIdentifier *string         `json:"entity_identifier"`
	Name             *string         `json:"name"`
	ParentID         *string         `json:"parent"`
	ProjectID        *string         `json:"project"`
	IsFolder         *bool           `json:"is_folder"`
	Metadata         json.RawMessage `json:"metadata"`
	present          map[string]bool
}

func (p *WritePayload) UnmarshalJSON(data []byte) error {
	type plain WritePayload
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*p = WritePayload(decoded)
	p.present = make(map[string]bool, len(fields))
	for field := range fields {
		p.present[field] = true
	}
	return nil
}

func (p WritePayload) has(field string) bool { return p.present[field] }

type writeIdentity struct {
	UserID      string
	WorkspaceID string
	Role        int
}

type Store interface {
	ListForSession(ctx context.Context, sessionKey, slug string) ([]FavoriteItem, error)
	ListGroupForSession(ctx context.Context, sessionKey, slug, parentID string) ([]FavoriteItem, error)
	CreateForSession(ctx context.Context, sessionKey, slug string, input WritePayload) (FavoriteItem, error)
	UpdateForSession(ctx context.Context, sessionKey, slug, favoriteID string, input WritePayload) (FavoriteItem, error)
	DeleteForSession(ctx context.Context, sessionKey, slug, favoriteID string) error
	ListProjectFavoritesForSession(ctx context.Context, sessionKey, slug, projectID, entityType string) ([]FavoriteItem, error)
	CreateProjectFavoriteForSession(ctx context.Context, sessionKey, slug, projectID, entityType, entityIdentifier string) error
	DeleteProjectFavoriteForSession(ctx context.Context, sessionKey, slug, projectID, entityType, entityIdentifier string) error
	Available() bool
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) Available() bool {
	return s.Pool != nil
}

func (s PostgreSQLStore) writeIdentity(ctx context.Context, sessionKey, slug string) (writeIdentity, error) {
	if s.Pool == nil {
		return writeIdentity{}, errors.New("database unavailable")
	}
	if sessionKey == "" {
		return writeIdentity{}, ErrUnauthorized
	}
	var identity writeIdentity
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, wm.role
		FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id::text=s.user_id
			AND wm.is_active=TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug).Scan(&identity.UserID, &identity.WorkspaceID, &identity.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		var valid bool
		if checkErr := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&valid); checkErr != nil {
			return writeIdentity{}, fmt.Errorf("check session: %w", checkErr)
		}
		if valid {
			return writeIdentity{}, ErrForbidden
		}
		return writeIdentity{}, ErrUnauthorized
	}
	return identity, err
}

const favColumns = `f.id::text, f.workspace_id::text, f.project_id::text, f.parent_id::text,
	f.entity_type, f.entity_identifier::text, f.sequence, COALESCE(f.name,''), f.is_folder, '{}'::jsonb AS metadata,
	f.created_at, f.updated_at, f.created_by_id::text, f.updated_by_id::text`

func scanFavorite(row rowScanner) (FavoriteItem, error) {
	var f FavoriteItem
	var metaJSON []byte
	err := row.Scan(&f.ID, &f.WorkspaceID, &f.ProjectID, &f.ParentID,
		&f.EntityType, &f.EntityIdentifier, &f.Sequence, &f.Name, &f.IsFolder, &metaJSON,
		&f.CreatedAt, &f.UpdatedAt, &f.CreatedBy, &f.UpdatedBy)
	if err != nil {
		return FavoriteItem{}, err
	}
	if metaJSON != nil {
		f.Metadata = json.RawMessage(metaJSON)
	} else {
		f.Metadata = json.RawMessage(`{}`)
	}
	return f, nil
}

type rowScanner interface{ Scan(...any) error }

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string) ([]FavoriteItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}

	rows, err := s.Pool.Query(ctx, `SELECT `+favColumns+` FROM user_favorites f
		LEFT JOIN projects p ON p.id = f.project_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id::text = $1 AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		WHERE f.user_id::text=$1 AND f.workspace_id::text=$2 AND f.parent_id IS NULL AND f.deleted_at IS NULL
		AND (
			f.project_id IS NULL AND f.entity_type <> 'page'
			OR (f.project_id IS NOT NULL AND pm.role IS NOT NULL)
		)
		ORDER BY f.sequence ASC, f.created_at DESC`, identity.UserID, identity.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []FavoriteItem
	for rows.Next() {
		item, scanErr := scanFavorite(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) ListGroupForSession(ctx context.Context, sessionKey, slug, parentID string) ([]FavoriteItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}

	rows, err := s.Pool.Query(ctx, `SELECT `+favColumns+` FROM user_favorites f
		LEFT JOIN projects p ON p.id = f.project_id
		LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id::text = $1 AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		WHERE f.user_id::text=$1 AND f.workspace_id::text=$2 AND f.parent_id::text=$3 AND f.deleted_at IS NULL
		AND (
			f.project_id IS NULL
			OR (f.project_id IS NOT NULL AND pm.role IS NOT NULL)
		)
		ORDER BY f.sequence ASC, f.created_at DESC`, identity.UserID, identity.WorkspaceID, parentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []FavoriteItem
	for rows.Next() {
		item, scanErr := scanFavorite(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug string, input WritePayload) (FavoriteItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug)
	if err != nil {
		return FavoriteItem{}, err
	}
	if input.EntityType == nil || *input.EntityType == "" {
		return FavoriteItem{}, fmt.Errorf("%w: entity_type required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return FavoriteItem{}, err
	}
	defer tx.Rollback(ctx)

	// If favorite with entity_identifier exists, return it
	if input.EntityIdentifier != nil && *input.EntityIdentifier != "" {
		var existingID string
		err = tx.QueryRow(ctx, `SELECT id::text FROM user_favorites
			WHERE workspace_id::text=$1 AND user_id::text=$2 AND entity_type=$3 AND entity_identifier=$4 AND deleted_at IS NULL
			LIMIT 1`, identity.WorkspaceID, identity.UserID, *input.EntityType, *input.EntityIdentifier).Scan(&existingID)
		if err == nil {
			// Found, retrieve and return
			item, fetchErr := scanFavorite(tx.QueryRow(ctx, `SELECT `+favColumns+` FROM user_favorites f WHERE f.id::text=$1`, existingID))
			return item, fetchErr
		}
	}

	favoriteID := newUUID()

	isFolder := false
	if input.IsFolder != nil {
		isFolder = *input.IsFolder
	}

	entityIdentifier := ""
	if input.EntityIdentifier != nil {
		entityIdentifier = *input.EntityIdentifier
	}

	name := ""
	if input.Name != nil {
		name = *input.Name
	}

	// Calculate sequence (get max + 10000)
	var maxSeq float64
	_ = tx.QueryRow(ctx, `SELECT COALESCE(MAX(sequence), 0) FROM user_favorites WHERE workspace_id::text=$1 AND user_id::text=$2 AND deleted_at IS NULL`,
		identity.WorkspaceID, identity.UserID).Scan(&maxSeq)
	sequence := maxSeq + 10000

	_, err = tx.Exec(ctx, `INSERT INTO user_favorites
		(id, workspace_id, project_id, parent_id, entity_type, entity_identifier, sequence, name, is_folder,
		 user_id, created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,$5,$6,$7,$8,$9,
			$10::uuid,$10::uuid,$10::uuid,NOW(),NOW())`,
		favoriteID, identity.WorkspaceID, stringValue(input.ProjectID), stringValue(input.ParentID),
		*input.EntityType, entityIdentifier, sequence, name, isFolder, identity.UserID)
	if err != nil {
		return FavoriteItem{}, err
	}

	item, err := scanFavorite(tx.QueryRow(ctx, `SELECT `+favColumns+` FROM user_favorites f WHERE f.id::text=$1`, favoriteID))
	if err != nil {
		return FavoriteItem{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return FavoriteItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, favoriteID string, input WritePayload) (FavoriteItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug)
	if err != nil {
		return FavoriteItem{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return FavoriteItem{}, err
	}
	defer tx.Rollback(ctx)

	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM user_favorites WHERE id::text=$1 AND user_id::text=$2 AND workspace_id::text=$3 AND deleted_at IS NULL)`,
		favoriteID, identity.UserID, identity.WorkspaceID).Scan(&exists)
	if err != nil {
		return FavoriteItem{}, err
	}
	if !exists {
		return FavoriteItem{}, ErrNotFound
	}


	_, err = tx.Exec(ctx, `UPDATE user_favorites SET
		name=CASE WHEN $4 THEN $5 ELSE name END,
		parent_id=CASE WHEN $6 THEN NULLIF($7,'')::uuid ELSE parent_id END,
		updated_by_id=$8, updated_at=NOW()
		WHERE id::text=$1 AND user_id::text=$8 AND workspace_id::text=$9 AND deleted_at IS NULL`,
		favoriteID, identity.UserID, identity.WorkspaceID,
		input.has("name"), input.Name,
		input.has("parent"), stringValue(input.ParentID),
		identity.UserID, identity.WorkspaceID)
	if err != nil {
		return FavoriteItem{}, err
	}

	item, err := scanFavorite(tx.QueryRow(ctx, `SELECT `+favColumns+` FROM user_favorites f WHERE f.id::text=$1`, favoriteID))
	if err != nil {
		return FavoriteItem{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return FavoriteItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, favoriteID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug)
	if err != nil {
		return err
	}

	// Hard delete matching Django behavior (favorite.delete(soft=False))
	result, err := s.Pool.Exec(ctx, `DELETE FROM user_favorites
		WHERE id::text=$1 AND user_id::text=$2 AND workspace_id::text=$3`,
		favoriteID, identity.UserID, identity.WorkspaceID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func normalizedJSON(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return `{}`
	}
	return string(raw)
}

func stringValue(val *string) string {
	if val == nil {
		return ""
	}
	return *val
}

func (s PostgreSQLStore) ListProjectFavoritesForSession(ctx context.Context, sessionKey, slug, projectID, entityType string) ([]FavoriteItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}

	rows, err := s.Pool.Query(ctx, `SELECT `+favColumns+` FROM user_favorites f
		INNER JOIN project_members pm ON pm.project_id = f.project_id AND pm.member_id::text = $1 AND pm.is_active = TRUE AND pm.deleted_at IS NULL
		WHERE f.user_id::text=$1 AND f.workspace_id::text=$2 AND f.project_id::text=$3 AND f.entity_type=$4 AND f.deleted_at IS NULL
		ORDER BY f.sequence ASC, f.created_at DESC`, identity.UserID, identity.WorkspaceID, projectID, entityType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []FavoriteItem
	for rows.Next() {
		item, scanErr := scanFavorite(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) CreateProjectFavoriteForSession(ctx context.Context, sessionKey, slug, projectID, entityType, entityIdentifier string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug)
	if err != nil {
		return err
	}

	// Ensure the user is a member of the project
	var memberExists bool
	err = s.Pool.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM project_members 
		WHERE workspace_id::text=$1 AND project_id::text=$2 AND member_id::text=$3 AND is_active=TRUE AND deleted_at IS NULL
	)`, identity.WorkspaceID, projectID, identity.UserID).Scan(&memberExists)
	if err != nil {
		return err
	}
	if !memberExists {
		return ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var existingID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM user_favorites
		WHERE workspace_id::text=$1 AND user_id::text=$2 AND project_id::text=$3 AND entity_type=$4 AND entity_identifier=$5 AND deleted_at IS NULL
		LIMIT 1`, identity.WorkspaceID, identity.UserID, projectID, entityType, entityIdentifier).Scan(&existingID)
	if err == nil {
		// Already exists, just return (similar to Django returning 204 directly)
		return nil
	}

	favoriteID := newUUID()
	var maxSeq float64
	_ = tx.QueryRow(ctx, `SELECT COALESCE(MAX(sequence), 0) FROM user_favorites WHERE workspace_id::text=$1 AND user_id::text=$2 AND deleted_at IS NULL`,
		identity.WorkspaceID, identity.UserID).Scan(&maxSeq)
	sequence := maxSeq + 10000

	_, err = tx.Exec(ctx, `INSERT INTO user_favorites
		(id, workspace_id, project_id, parent_id, entity_type, entity_identifier, sequence, name, is_folder,
		 user_id, created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,$3::uuid,NULL,$4,$5,$6,'',FALSE,
			$7::uuid,$7::uuid,$7::uuid,NOW(),NOW())`,
		favoriteID, identity.WorkspaceID, projectID, entityType, entityIdentifier, sequence, identity.UserID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s PostgreSQLStore) DeleteProjectFavoriteForSession(ctx context.Context, sessionKey, slug, projectID, entityType, entityIdentifier string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug)
	if err != nil {
		return err
	}

	result, err := s.Pool.Exec(ctx, `DELETE FROM user_favorites
		WHERE user_id::text=$1 AND workspace_id::text=$2 AND project_id::text=$3 AND entity_type=$4 AND entity_identifier=$5`,
		identity.UserID, identity.WorkspaceID, projectID, entityType, entityIdentifier)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
