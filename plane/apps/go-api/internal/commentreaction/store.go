package commentreaction

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
	CommentID    string    `json:"comment"`
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
	Reaction *string `json:"reaction"`
}

type writeIdentity struct {
	UserID      string
	WorkspaceID string
	ProjectID   string
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
		JOIN project_members pm ON pm.project_id::text=$3 AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug, projectID).Scan(&identity.UserID, &identity.WorkspaceID, &identity.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return writeIdentity{}, ErrForbidden
	}
	identity.ProjectID = projectID
	return identity, err
}

const reactionCols = `r.id::text, r.reaction, r.comment_id::text, r.actor_id::text, r.project_id::text, r.workspace_id::text,
	r.created_by_id::text, r.updated_by_id::text, r.created_at, r.updated_at,
	u.id::text, COALESCE(u.first_name, ''), COALESCE(u.last_name, ''), COALESCE(u.email, ''), COALESCE(u.avatar, '')`

func scanReaction(row pgx.Row) (ReactionItem, error) {
	var item ReactionItem
	err := row.Scan(&item.ID, &item.Reaction, &item.CommentID, &item.ActorID, &item.ProjectID, &item.WorkspaceID,
		&item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt,
		&item.ActorDetails.ID, &item.ActorDetails.FirstName, &item.ActorDetails.LastName,
		&item.ActorDetails.Email, &item.ActorDetails.Avatar)
	return item, err
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID, commentID string) ([]ReactionItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+reactionCols+`
		FROM comment_reactions r
		JOIN users u ON u.id = r.actor_id
		WHERE r.project_id::text=$1 AND r.workspace_id::text=$2 AND r.comment_id::text=$3 AND r.deleted_at IS NULL
		ORDER BY r.created_at ASC`, identity.ProjectID, identity.WorkspaceID, commentID)
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

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID, commentID string, input WritePayload) (ReactionItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return ReactionItem{}, err
	}
	if identity.Role < 5 {
		return ReactionItem{}, ErrForbidden
	}
	if input.Reaction == nil || *input.Reaction == "" {
		return ReactionItem{}, fmt.Errorf("%w: reaction character required", ErrInvalid)
	}

	var exists bool
	err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issue_comments WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`,
		commentID, identity.ProjectID).Scan(&exists)
	if err != nil {
		return ReactionItem{}, err
	}
	if !exists {
		return ReactionItem{}, errors.New("comment not found")
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ReactionItem{}, err
	}
	defer tx.Rollback(ctx)

	var existingID string
	var existingDeleted *time.Time
	err = tx.QueryRow(ctx, `SELECT id::text, deleted_at FROM comment_reactions
		WHERE comment_id::text=$1 AND actor_id::text=$2 AND reaction=$3 AND project_id::text=$4`,
		commentID, identity.UserID, *input.Reaction, identity.ProjectID).Scan(&existingID, &existingDeleted)

	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ReactionItem{}, err
	}

	if existingID != "" {
		if existingDeleted == nil {
			return ReactionItem{}, ErrConflict
		}
		_, err = tx.Exec(ctx, `UPDATE comment_reactions SET deleted_at=NULL, updated_at=NOW(), updated_by_id=$1 WHERE id::uuid=$2`,
			identity.UserID, existingID)
		if err != nil {
			return ReactionItem{}, err
		}
	} else {
		existingID = newUUID()
		_, err = tx.Exec(ctx, `INSERT INTO comment_reactions (id, workspace_id, project_id, comment_id, actor_id, reaction,
			created_at, updated_at, created_by_id, updated_by_id)
			VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, NOW(), NOW(), $5::uuid, $5::uuid)`,
			existingID, identity.WorkspaceID, identity.ProjectID, commentID, identity.UserID, *input.Reaction)
		if err != nil {
			return ReactionItem{}, err
		}
	}

	item, err := scanReaction(tx.QueryRow(ctx, `SELECT `+reactionCols+` FROM comment_reactions r JOIN users u ON u.id=r.actor_id WHERE r.id::text=$1`, existingID))
	if err != nil {
		return ReactionItem{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return ReactionItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, commentID, reaction string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if identity.Role < 5 {
		return ErrForbidden
	}

	res, err := s.Pool.Exec(ctx, `UPDATE comment_reactions SET deleted_at=NOW(), updated_at=NOW(), updated_by_id=$1
		WHERE comment_id::text=$2 AND actor_id::text=$1 AND reaction=$3 AND project_id::text=$4 AND deleted_at IS NULL`,
		identity.UserID, commentID, reaction, identity.ProjectID)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
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
