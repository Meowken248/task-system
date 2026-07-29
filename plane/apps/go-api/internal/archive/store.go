package archive

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("issue not found")
	ErrInvalid      = errors.New("invalid state group for archive")
)

type writeIdentity struct {
	UserID      string
	WorkspaceID string
	Role        int
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) writeIdentity(ctx context.Context, sessionKey, slug, projectID string) (writeIdentity, error) {
	if s.Pool == nil {
		return writeIdentity{}, errors.New("database unavailable")
	}
	if sessionKey == "" {
		return writeIdentity{}, ErrUnauthorized
	}
	var identity writeIdentity
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, pm.role
		FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`).Scan(&identity.UserID, &identity.WorkspaceID, &identity.Role)
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

// Archive single issue.
func (s PostgreSQLStore) Archive(ctx context.Context, sessionKey, slug, projectID, issueID string) (time.Time, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return time.Time{}, err
	}
	if identity.Role < 15 {
		return time.Time{}, ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback(ctx)

	// Verify state group (completed or cancelled)
	var stateGroup string
	err = tx.QueryRow(ctx, `SELECT st."group" FROM issues i
		JOIN states st ON st.id=i.state_id
		WHERE i.id::text=$1 AND i.project_id::text=$2 AND i.deleted_at IS NULL`, issueID, projectID).Scan(&stateGroup)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, ErrNotFound
	}
	if err != nil {
		return time.Time{}, err
	}
	if stateGroup != "completed" && stateGroup != "cancelled" {
		return time.Time{}, ErrInvalid
	}

	now := time.Now()
	_, err = tx.Exec(ctx, `UPDATE issues SET archived_at=$1, updated_by_id=$2, updated_at=NOW()
		WHERE id::text=$3 AND project_id::text=$4 AND deleted_at IS NULL`, now, identity.UserID, issueID, projectID)
	if err != nil {
		return time.Time{}, err
	}

	// Record activity
	_, err = tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, verb, comment, attachments, actor_id, epoch,
		 project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,'updated','archived the issue','{}'::text[],$3,$4,$5::uuid,$6::uuid,$3,NOW(),NOW())`,
		newUUID(), issueID, identity.UserID, now.Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return time.Time{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return time.Time{}, err
	}

	return now, nil
}

// Unarchive single issue.
func (s PostgreSQLStore) Unarchive(ctx context.Context, sessionKey, slug, projectID, issueID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if identity.Role < 15 {
		return ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issues
		WHERE id::text=$1 AND project_id::text=$2 AND archived_at IS NOT NULL AND deleted_at IS NULL)`, issueID, projectID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}

	_, err = tx.Exec(ctx, `UPDATE issues SET archived_at=NULL, updated_by_id=$2, updated_at=NOW()
		WHERE id::text=$1 AND project_id::text=$3 AND deleted_at IS NULL`, issueID, identity.UserID, projectID)
	if err != nil {
		return err
	}

	// Record activity
	_, err = tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, verb, comment, attachments, actor_id, epoch,
		 project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,'updated','unarchived the issue','{}'::text[],$3,$4,$5::uuid,$6::uuid,$3,NOW(),NOW())`,
		newUUID(), issueID, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// BulkArchive multiple issues.
func (s PostgreSQLStore) BulkArchive(ctx context.Context, sessionKey, slug, projectID string, issueIDs []string) (time.Time, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return time.Time{}, err
	}
	if identity.Role < 15 {
		return time.Time{}, ErrForbidden
	}
	if len(issueIDs) == 0 {
		return time.Time{}, nil
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback(ctx)

	// Check state groups for all input issues
	rows, err := tx.Query(ctx, `SELECT i.id::text, st."group" FROM issues i
		JOIN states st ON st.id=i.state_id
		WHERE i.id::text=ANY($1) AND i.project_id::text=$2 AND i.deleted_at IS NULL`, issueIDs, projectID)
	if err != nil {
		return time.Time{}, err
	}
	defer rows.Close()

	var validIDs []string
	for rows.Next() {
		var id, group string
		if err := rows.Scan(&id, &group); err != nil {
			return time.Time{}, err
		}
		if group != "completed" && group != "cancelled" {
			return time.Time{}, ErrInvalid
		}
		validIDs = append(validIDs, id)
	}

	now := time.Now()
	_, err = tx.Exec(ctx, `UPDATE issues SET archived_at=$1, updated_by_id=$2, updated_at=NOW()
		WHERE id::text=ANY($3) AND project_id::text=$4 AND deleted_at IS NULL`, now, identity.UserID, validIDs, projectID)
	if err != nil {
		return time.Time{}, err
	}

	// Record activity for each
	for _, id := range validIDs {
		_, err = tx.Exec(ctx, `INSERT INTO issue_activities
			(id, issue_id, verb, comment, attachments, actor_id, epoch,
			 project_id, workspace_id, created_by_id, created_at, updated_at)
			VALUES ($1,$2::uuid,'updated','archived the issue','{}'::text[],$3,$4,$5::uuid,$6::uuid,$3,NOW(),NOW())`,
			newUUID(), id, identity.UserID, now.Unix(), projectID, identity.WorkspaceID)
		if err != nil {
			return time.Time{}, err
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return time.Time{}, err
	}

	return now, nil
}

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}
