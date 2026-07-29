package reaction

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
	ErrNotFound     = errors.New("reaction not found")
	ErrInvalid      = errors.New("invalid reaction")
	ErrConflict     = errors.New("reaction already exists")
)

type ReactionItem struct {
	ID           string    `json:"id"`
	Reaction     string    `json:"reaction"`
	IssueID      string    `json:"issue"`
	ActorID      string    `json:"actor"`
	ProjectID    string    `json:"project"`
	WorkspaceID  string    `json:"workspace"`
	CreatedBy    string    `json:"created_by"`
	UpdatedBy    string    `json:"updated_by"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	ActorDetails struct {
		ID        string `json:"id"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Email     string `json:"email"`
		Avatar    string `json:"avatar"`
	} `json:"actor_detail"`
}

type WritePayload struct {
	Reaction string `json:"reaction"`
}

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

const reactionColumns = `r.id::text, r.reaction, r.issue_id::text, r.actor_id::text,
	r.project_id::text, r.workspace_id::text,
	r.created_by_id::text, r.updated_by_id::text, r.created_at, r.updated_at,
	u.id::text, COALESCE(u.first_name,''), COALESCE(u.last_name,''), u.email, COALESCE(u.avatar,'')`

func scanReaction(row rowScanner) (ReactionItem, error) {
	var r ReactionItem
	err := row.Scan(&r.ID, &r.Reaction, &r.IssueID, &r.ActorID,
		&r.ProjectID, &r.WorkspaceID,
		&r.CreatedBy, &r.UpdatedBy, &r.CreatedAt, &r.UpdatedAt,
		&r.ActorDetails.ID, &r.ActorDetails.FirstName, &r.ActorDetails.LastName, &r.ActorDetails.Email, &r.ActorDetails.Avatar)
	return r, err
}

type rowScanner interface{ Scan(...any) error }

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID, issueID string) ([]ReactionItem, error) {
	if _, err := s.writeIdentity(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+reactionColumns+` FROM issue_reactions r
		JOIN users u ON u.id = r.actor_id
		WHERE r.project_id::text=$1 AND r.issue_id::text=$2 AND r.deleted_at IS NULL
		ORDER BY r.created_at DESC`, projectID, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []ReactionItem
	for rows.Next() {
		item, scanErr := scanReaction(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID, issueID string, input WritePayload) (ReactionItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return ReactionItem{}, err
	}
	if identity.Role < 5 { // Guests can react
		return ReactionItem{}, ErrForbidden
	}
	if input.Reaction == "" {
		return ReactionItem{}, fmt.Errorf("%w: reaction is required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ReactionItem{}, err
	}
	defer tx.Rollback(ctx)

	// Check if issue exists
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issues WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, issueID, projectID).Scan(&exists)
	if err != nil {
		return ReactionItem{}, err
	}
	if !exists {
		return ReactionItem{}, ErrNotFound
	}

	// Check for existing reaction
	var hasReacted bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issue_reactions
		WHERE issue_id::text=$1 AND actor_id::text=$2 AND reaction=$3 AND deleted_at IS NULL)`,
		issueID, identity.UserID, input.Reaction).Scan(&hasReacted)
	if err != nil {
		return ReactionItem{}, err
	}
	if hasReacted {
		return ReactionItem{}, ErrConflict
	}

	reactID := newUUID()
	_, err = tx.Exec(ctx, `INSERT INTO issue_reactions
		(id, reaction, issue_id, actor_id, project_id, workspace_id,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$4,$4,NOW(),NOW())`,
		reactID, input.Reaction, issueID, identity.UserID, projectID, identity.WorkspaceID)
	if err != nil {
		return ReactionItem{}, err
	}

	// Record activity
	_, err = tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, verb, comment, attachments, actor_id, epoch,
		 project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,'created','reacted to the issue','{}'::text[],$3,$4,$5::uuid,$6::uuid,$3,NOW(),NOW())`,
		newUUID(), issueID, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return ReactionItem{}, err
	}

	item, err := scanReaction(tx.QueryRow(ctx, `SELECT `+reactionColumns+` FROM issue_reactions r
		JOIN users u ON u.id = r.actor_id
		WHERE r.id::text=$1`, reactID))
	if err != nil {
		return ReactionItem{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return ReactionItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, issueID, reactionCode string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if identity.Role < 5 {
		return ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	result, err := tx.Exec(ctx, `UPDATE issue_reactions SET deleted_at=NOW(), updated_by_id=$4, updated_at=NOW()
		WHERE issue_id::text=$1 AND actor_id::text=$2 AND reaction=$3 AND deleted_at IS NULL`,
		issueID, identity.UserID, reactionCode, identity.UserID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}

	// Record activity
	_, err = tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, verb, comment, attachments, actor_id, epoch,
		 project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,'deleted','removed reaction','{}'::text[],$3,$4,$5::uuid,$6::uuid,$3,NOW(),NOW())`,
		newUUID(), issueID, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}
