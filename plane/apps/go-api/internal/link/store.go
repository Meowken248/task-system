package link

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("link not found")
	ErrInvalid      = errors.New("invalid link")
)

type LinkItem struct {
	ID          string          `json:"id"`
	Title       *string         `json:"title"`
	URL         string          `json:"url"`
	Metadata    json.RawMessage `json:"metadata"`
	IssueID     string          `json:"issue"`
	ProjectID   string          `json:"project"`
	WorkspaceID string          `json:"workspace"`
	CreatedBy   *string         `json:"created_by"`
	UpdatedBy   *string         `json:"updated_by"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type WritePayload struct {
	Title    *string         `json:"title"`
	URL      *string         `json:"url"`
	Metadata json.RawMessage `json:"metadata"`
	present  map[string]bool
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

const linkColumns = `l.id::text, l.title, l.url, l.metadata, l.issue_id::text,
	l.project_id::text, l.workspace_id::text,
	l.created_by_id::text, l.updated_by_id::text, l.created_at, l.updated_at`

func scanLink(row rowScanner) (LinkItem, error) {
	var l LinkItem
	var metaJSON []byte
	err := row.Scan(&l.ID, &l.Title, &l.URL, &metaJSON, &l.IssueID,
		&l.ProjectID, &l.WorkspaceID,
		&l.CreatedBy, &l.UpdatedBy, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return LinkItem{}, err
	}
	if metaJSON != nil {
		l.Metadata = json.RawMessage(metaJSON)
	} else {
		l.Metadata = json.RawMessage(`{}`)
	}
	return l, nil
}

type rowScanner interface{ Scan(...any) error }

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID, issueID string) ([]LinkItem, error) {
	if _, err := s.writeIdentity(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+linkColumns+` FROM issue_links l
		WHERE l.project_id::text=$1 AND l.issue_id::text=$2 AND l.deleted_at IS NULL
		ORDER BY l.created_at DESC`, projectID, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []LinkItem
	for rows.Next() {
		item, scanErr := scanLink(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID, issueID string, input WritePayload) (LinkItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return LinkItem{}, err
	}
	if identity.Role < 15 {
		return LinkItem{}, ErrForbidden
	}
	if input.URL == nil || strings.TrimSpace(*input.URL) == "" {
		return LinkItem{}, fmt.Errorf("%w: url is required", ErrInvalid)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return LinkItem{}, err
	}
	defer tx.Rollback(ctx)

	// Check if issue exists
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issues WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, issueID, projectID).Scan(&exists)
	if err != nil {
		return LinkItem{}, err
	}
	if !exists {
		return LinkItem{}, ErrNotFound
	}

	linkID := newUUID()
	meta := normalizedJSON(input.Metadata)

	_, err = tx.Exec(ctx, `INSERT INTO issue_links
		(id, title, url, metadata, issue_id, project_id, workspace_id,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$8::uuid,NOW(),NOW())`,
		linkID, input.Title, *input.URL, meta, issueID, projectID, identity.WorkspaceID, identity.UserID)
	if err != nil {
		return LinkItem{}, err
	}

	// Record activity
	_, err = tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, verb, comment, attachments, actor_id, epoch,
		 project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,'created','added a link','{}'::text[],$3,$4,$5::uuid,$6::uuid,$3,NOW(),NOW())`,
		newUUID(), issueID, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return LinkItem{}, err
	}

	item, err := scanLink(tx.QueryRow(ctx, `SELECT `+linkColumns+` FROM issue_links l WHERE l.id::text=$1`, linkID))
	if err != nil {
		return LinkItem{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return LinkItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, issueID, linkID string, input WritePayload) (LinkItem, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return LinkItem{}, err
	}
	if identity.Role < 15 {
		return LinkItem{}, ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return LinkItem{}, err
	}
	defer tx.Rollback(ctx)

	// Check if link exists
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issue_links WHERE id::text=$1 AND issue_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL)`, linkID, issueID, projectID).Scan(&exists)
	if err != nil {
		return LinkItem{}, err
	}
	if !exists {
		return LinkItem{}, ErrNotFound
	}

	meta := normalizedJSON(input.Metadata)

	_, err = tx.Exec(ctx, `UPDATE issue_links SET
		title=CASE WHEN $4 THEN $5 ELSE title END,
		url=CASE WHEN $6 THEN $7 ELSE url END,
		metadata=CASE WHEN $8 THEN $9 ELSE metadata END,
		updated_by_id=$10, updated_at=NOW()
		WHERE id::text=$1 AND issue_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL`,
		linkID, issueID, projectID,
		input.has("title"), input.Title,
		input.has("url"), input.URL,
		input.has("metadata"), meta,
		identity.UserID)
	if err != nil {
		return LinkItem{}, err
	}

	// Record activity
	_, err = tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, verb, comment, attachments, actor_id, epoch,
		 project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,'updated','updated a link','{}'::text[],$3,$4,$5::uuid,$6::uuid,$3,NOW(),NOW())`,
		newUUID(), issueID, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return LinkItem{}, err
	}

	item, err := scanLink(tx.QueryRow(ctx, `SELECT `+linkColumns+` FROM issue_links l WHERE l.id::text=$1`, linkID))
	if err != nil {
		return LinkItem{}, err
	}

	if err = tx.Commit(ctx); err != nil {
		return LinkItem{}, err
	}
	return item, nil
}

func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, issueID, linkID string) error {
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

	result, err := tx.Exec(ctx, `UPDATE issue_links SET deleted_at=NOW(), updated_by_id=$4, updated_at=NOW()
		WHERE id::text=$1 AND issue_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL`,
		linkID, issueID, projectID, identity.UserID)
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
		VALUES ($1,$2::uuid,'deleted','deleted a link','{}'::text[],$3,$4,$5::uuid,$6::uuid,$3,NOW(),NOW())`,
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

func normalizedJSON(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return `{}`
	}
	return string(raw)
}
