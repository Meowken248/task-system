package subscriber

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
	ErrNotFound     = errors.New("subscriber not found")
	ErrConflict     = errors.New("already subscribed")
)

type MemberItem struct {
	ID        string `json:"id"`
	Member struct {
		ID        string `json:"id"`
		FirstName string `json:"first_name"`
		LastName  string `json:"last_name"`
		Email     string `json:"email"`
		Avatar    string `json:"avatar"`
	} `json:"member"`
	Role int `json:"role"`
}

type SubscriberItem struct {
	ID          string    `json:"id"`
	IssueID     string    `json:"issue"`
	Subscriber  string    `json:"subscriber"`
	ProjectID   string    `json:"project"`
	WorkspaceID string    `json:"workspace"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
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

// ListForSession returns active project members (lite format) as Django's list method does.
func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID string) ([]MemberItem, error) {
	if _, err := s.writeIdentity(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT pm.id::text, pm.role,
		u.id::text, COALESCE(u.first_name,''), COALESCE(u.last_name,''), u.email, COALESCE(u.avatar,'')
		FROM project_members pm
		JOIN users u ON u.id = pm.member_id
		WHERE pm.project_id::text=$1 AND pm.is_active=TRUE AND pm.deleted_at IS NULL`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []MemberItem
	for rows.Next() {
		var m MemberItem
		err := rows.Scan(&m.ID, &m.Role,
			&m.Member.ID, &m.Member.FirstName, &m.Member.LastName, &m.Member.Email, &m.Member.Avatar)
		if err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}

// Subscribe user to the issue.
func (s PostgreSQLStore) Subscribe(ctx context.Context, sessionKey, slug, projectID, issueID string) (SubscriberItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return SubscriberItem{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return SubscriberItem{}, err
	}
	defer tx.Rollback(ctx)

	// Check if already subscribed
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issue_subscribers
		WHERE issue_id::text=$1 AND subscriber_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL)`,
		issueID, identity.UserID, projectID).Scan(&exists)
	if err != nil {
		return SubscriberItem{}, err
	}
	if exists {
		return SubscriberItem{}, ErrConflict
	}

	subID := newUUID()
	createdAt := time.Now()
	_, err = tx.Exec(ctx, `INSERT INTO issue_subscribers
		(id, workspace_id, project_id, issue_id, subscriber_id,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$5::uuid,$5::uuid,$6,$6)`,
		subID, identity.WorkspaceID, projectID, issueID, identity.UserID, createdAt)
	if err != nil {
		return SubscriberItem{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return SubscriberItem{}, err
	}

	return SubscriberItem{
		ID:          subID,
		IssueID:     issueID,
		Subscriber:  identity.UserID,
		ProjectID:   projectID,
		WorkspaceID: identity.WorkspaceID,
		CreatedAt:   createdAt,
		UpdatedAt:   createdAt,
	}, nil
}

// Unsubscribe current user from the issue.
func (s PostgreSQLStore) Unsubscribe(ctx context.Context, sessionKey, slug, projectID, issueID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}

	result, err := s.Pool.Exec(ctx, `UPDATE issue_subscribers SET deleted_at=NOW(), updated_by_id=$4, updated_at=NOW()
		WHERE project_id::text=$1 AND subscriber_id::text=$2 AND issue_id::text=$3 AND deleted_at IS NULL`,
		projectID, identity.UserID, issueID, identity.UserID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RemoveSubscriber deletes a specific subscriber (used in destroy action).
func (s PostgreSQLStore) RemoveSubscriber(ctx context.Context, sessionKey, slug, projectID, issueID, subscriberID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	if identity.Role < 15 {
		return ErrForbidden
	}

	result, err := s.Pool.Exec(ctx, `UPDATE issue_subscribers SET deleted_at=NOW(), updated_by_id=$5, updated_at=NOW()
		WHERE project_id::text=$1 AND subscriber_id::text=$2 AND issue_id::text=$3 AND deleted_at IS NULL`,
		projectID, subscriberID, issueID, identity.UserID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetSubscriptionStatus returns true if user is subscribed.
func (s PostgreSQLStore) GetSubscriptionStatus(ctx context.Context, sessionKey, slug, projectID, issueID string) (bool, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return false, err
	}

	var subscribed bool
	err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issue_subscribers
		WHERE issue_id::text=$1 AND subscriber_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL)`,
		issueID, identity.UserID, projectID).Scan(&subscribed)
	return subscribed, err
}

func newUUID() string {
	var bytes [16]byte
	_, _ = rand.Read(bytes[:])
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}
