package comment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("project access denied")
	ErrNotFound     = errors.New("comment not found")
	ErrInvalid      = errors.New("invalid comment")
	tagPattern      = regexp.MustCompile(`<[^>]*>`)
	dangerHTML      = regexp.MustCompile(`(?i)<\s*(script|iframe|object|embed)|\son[a-z]+\s*=`)
)

// Comment represents a serialised issue comment matching Django IssueCommentSerializer.
type Comment struct {
	ID              string          `json:"id"`
	CommentStripped string          `json:"comment_stripped"`
	CommentJSON     json.RawMessage `json:"comment_json"`
	CommentHTML     string          `json:"comment_html"`
	Attachments     []string        `json:"attachments"`
	Access          string          `json:"access"`
	ExternalSource  *string         `json:"external_source"`
	ExternalID      *string         `json:"external_id"`
	EditedAt        *time.Time      `json:"edited_at"`
	ParentID        *string         `json:"parent_id"`
	IssueID         string          `json:"issue"`
	ActorID         *string         `json:"actor"`
	ProjectID       string          `json:"project"`
	WorkspaceID     string          `json:"workspace"`
	CreatedBy       *string         `json:"created_by"`
	UpdatedBy       *string         `json:"updated_by"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}

// WritePayload is the JSON body accepted by create and patch.
type WritePayload struct {
	CommentHTML    *string         `json:"comment_html"`
	CommentJSON    json.RawMessage `json:"comment_json"`
	Access         *string         `json:"access"`
	ExternalSource *string         `json:"external_source"`
	ExternalID     *string         `json:"external_id"`
	ParentID       *string         `json:"parent_id"`
	present        map[string]bool
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

// PostgreSQLStore implements comment CRUD against Django-managed tables.
type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) authorize(ctx context.Context, sessionKey, slug, projectID string) error {
	if s.Pool == nil {
		return errors.New("comment database unavailable")
	}
	if sessionKey == "" {
		return ErrUnauthorized
	}
	var allowed bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions s
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN projects p ON p.id::text=$3 AND p.workspace_id=w.id AND p.deleted_at IS NULL AND p.archived_at IS NULL
		JOIN project_members pm ON pm.project_id=p.id AND pm.member_id::text=s.user_id
			AND pm.is_active=TRUE AND pm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW())`, sessionKey, slug, projectID).Scan(&allowed)
	if err != nil {
		return fmt.Errorf("resolve comment access: %w", err)
	}
	if allowed {
		return nil
	}
	var validSession bool
	if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())`, sessionKey).Scan(&validSession); err != nil {
		return fmt.Errorf("check comment session: %w", err)
	}
	if validSession {
		return ErrForbidden
	}
	return ErrUnauthorized
}

func (s PostgreSQLStore) writeIdentity(ctx context.Context, sessionKey, slug, projectID string) (writeIdentity, error) {
	if s.Pool == nil {
		return writeIdentity{}, errors.New("comment database unavailable")
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
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug, projectID).
		Scan(&identity.UserID, &identity.WorkspaceID, &identity.Role)
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

const commentColumns = `c.id::text, c.comment_stripped, c.comment_json, c.comment_html,
	c.attachments, c.access, c.external_source, c.external_id, c.edited_at,
	c.parent_id::text, c.issue_id::text, c.actor_id::text,
	c.project_id::text, c.workspace_id::text,
	c.created_by_id::text, c.updated_by_id::text, c.created_at, c.updated_at`

func scanComment(row rowScanner) (Comment, error) {
	var c Comment
	var commentJSON []byte
	err := row.Scan(&c.ID, &c.CommentStripped, &commentJSON, &c.CommentHTML,
		&c.Attachments, &c.Access, &c.ExternalSource, &c.ExternalID, &c.EditedAt,
		&c.ParentID, &c.IssueID, &c.ActorID,
		&c.ProjectID, &c.WorkspaceID,
		&c.CreatedBy, &c.UpdatedBy, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return Comment{}, err
	}
	if commentJSON != nil {
		c.CommentJSON = json.RawMessage(commentJSON)
	} else {
		c.CommentJSON = json.RawMessage(`{}`)
	}
	if c.Attachments == nil {
		c.Attachments = []string{}
	}
	return c, nil
}

type rowScanner interface{ Scan(...any) error }

// ListForSession returns all comments for an issue, ordered by created_at DESC.
func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug, projectID, issueID string) ([]Comment, error) {
	if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+commentColumns+` FROM issue_comments c
		WHERE c.project_id::text=$1 AND c.issue_id::text=$2 AND c.deleted_at IS NULL
		ORDER BY c.created_at DESC`, projectID, issueID)
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	defer rows.Close()
	comments := make([]Comment, 0, 32)
	for rows.Next() {
		c, scanErr := scanComment(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan comment: %w", scanErr)
		}
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

// ListPublic returns all comments for an issue on a public board.
func (s PostgreSQLStore) ListPublic(ctx context.Context, projectID, issueID string) ([]Comment, error) {
	rows, err := s.Pool.Query(ctx, `SELECT `+commentColumns+` FROM issue_comments c
		WHERE c.project_id::text=$1 AND c.issue_id::text=$2 AND c.deleted_at IS NULL
		ORDER BY c.created_at DESC`, projectID, issueID)
	if err != nil {
		return nil, fmt.Errorf("list public comments: %w", err)
	}
	defer rows.Close()
	comments := make([]Comment, 0, 32)
	for rows.Next() {
		c, scanErr := scanComment(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("scan comment: %w", scanErr)
		}
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

// GetForSession retrieves a specific comment.
func (s PostgreSQLStore) GetForSession(ctx context.Context, sessionKey, slug, projectID, issueID, commentID string) (Comment, error) {
	if err := s.authorize(ctx, sessionKey, slug, projectID); err != nil {
		return Comment{}, err
	}
	c, err := scanComment(s.Pool.QueryRow(ctx, `SELECT `+commentColumns+` FROM issue_comments c
		WHERE c.project_id::text=$1 AND c.issue_id::text=$2 AND c.id::text=$3 AND c.deleted_at IS NULL`, projectID, issueID, commentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Comment{}, ErrNotFound
	}
	return c, err
}

// CreateForSession inserts a new comment and its Description record atomically.
func (s PostgreSQLStore) CreateForSession(ctx context.Context, sessionKey, slug, projectID, issueID string, input WritePayload) (Comment, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Comment{}, err
	}
	// GUEST (role=5) can only comment on issues they created, unless guest_view_all_features is set.
	if identity.Role == 5 {
		var guestAllowed bool
		err = s.Pool.QueryRow(ctx, `SELECT (p.guest_view_all_features OR i.created_by_id::text=$3)
			FROM projects p JOIN issues i ON i.id::text=$2 AND i.project_id=p.id
			WHERE p.id::text=$1 AND p.deleted_at IS NULL`, projectID, issueID, identity.UserID).Scan(&guestAllowed)
		if err != nil {
			return Comment{}, fmt.Errorf("check guest comment permission: %w", err)
		}
		if !guestAllowed {
			return Comment{}, fmt.Errorf("%w: guests cannot comment on this issue", ErrForbidden)
		}
	}
	// Require at least GUEST (role>=5)
	if identity.Role < 5 {
		return Comment{}, ErrForbidden
	}
	commentHTML := "<p></p>"
	if input.CommentHTML != nil {
		commentHTML = *input.CommentHTML
	}
	if dangerHTML.MatchString(commentHTML) {
		return Comment{}, fmt.Errorf("%w: unsafe comment_html", ErrInvalid)
	}
	commentStripped := stripHTML(commentHTML)
	commentJSON := normalizedJSON(input.CommentJSON)
	access := "INTERNAL"
	if input.Access != nil && (*input.Access == "INTERNAL" || *input.Access == "EXTERNAL") {
		access = *input.Access
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Comment{}, fmt.Errorf("begin create comment: %w", err)
	}
	defer tx.Rollback(ctx)

	// Verify issue exists in this project.
	var issueExists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM issues WHERE id::text=$1 AND project_id::text=$2 AND deleted_at IS NULL)`, issueID, projectID).Scan(&issueExists); err != nil {
		return Comment{}, err
	}
	if !issueExists {
		return Comment{}, fmt.Errorf("%w: issue not found", ErrNotFound)
	}

	// Create Description record first.
	descriptionID := newUUID()
	_, err = tx.Exec(ctx, `INSERT INTO descriptions
		(id, workspace_id, project_id, description_json, description_html, description_stripped,
		 created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$7,NOW(),NOW())`,
		descriptionID, identity.WorkspaceID, projectID, commentJSON, commentHTML, commentStripped, identity.UserID)
	if err != nil {
		return Comment{}, fmt.Errorf("insert comment description: %w", err)
	}

	// Create the comment.
	commentID := newUUID()
	_, err = tx.Exec(ctx, `INSERT INTO issue_comments
		(id, comment_stripped, comment_json, comment_html, attachments, access,
		 external_source, external_id, parent_id,
		 issue_id, actor_id, description_id,
		 project_id, workspace_id, created_by_id, updated_by_id, created_at, updated_at)
		VALUES ($1,$2,$3,$4,'{}'::text[],$5,$6,$7,NULLIF($8,'')::uuid,
			$9::uuid,$10,$11::uuid,
			$12::uuid,$13::uuid,$10,NULL,NOW(),NOW())`,
		commentID, commentStripped, commentJSON, commentHTML, access,
		input.ExternalSource, input.ExternalID, stringValue(input.ParentID),
		issueID, identity.UserID, descriptionID,
		projectID, identity.WorkspaceID)
	if err != nil {
		return Comment{}, fmt.Errorf("insert comment: %w", err)
	}

	// Record activity.
	if err = recordCommentActivity(ctx, tx, issueID, commentID, projectID, identity, "comment.activity.created"); err != nil {
		return Comment{}, err
	}

	c, err := scanComment(tx.QueryRow(ctx, `SELECT `+commentColumns+` FROM issue_comments c WHERE c.id::text=$1`, commentID))
	if err != nil {
		return Comment{}, fmt.Errorf("read created comment: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return Comment{}, fmt.Errorf("commit comment: %w", err)
	}
	return c, nil
}

// UpdateForSession patches a comment. Only ADMIN or the creator can update.
func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, projectID, issueID, commentID string, input WritePayload) (Comment, error) {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return Comment{}, err
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Comment{}, err
	}
	defer tx.Rollback(ctx)

	// Fetch existing comment and check ownership.
	var creatorID, oldHTML, descriptionID string
	err = tx.QueryRow(ctx, `SELECT COALESCE(created_by_id::text,''), comment_html, COALESCE(description_id::text,'')
		FROM issue_comments WHERE id::text=$1 AND issue_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL`,
		commentID, issueID, projectID).Scan(&creatorID, &oldHTML, &descriptionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Comment{}, ErrNotFound
	}
	if err != nil {
		return Comment{}, err
	}
	// ADMIN (role>=20) or creator.
	if identity.Role < 20 && creatorID != identity.UserID {
		return Comment{}, ErrForbidden
	}

	commentHTML := oldHTML
	if input.has("comment_html") && input.CommentHTML != nil {
		commentHTML = *input.CommentHTML
	}
	if dangerHTML.MatchString(commentHTML) {
		return Comment{}, fmt.Errorf("%w: unsafe comment_html", ErrInvalid)
	}
	commentStripped := stripHTML(commentHTML)
	commentJSON := normalizedJSON(input.CommentJSON)

	// Set edited_at only if content actually changed.
	editedClause := ""
	if input.has("comment_html") && commentHTML != oldHTML {
		editedClause = ", edited_at=NOW()"
	}

	_, err = tx.Exec(ctx, `UPDATE issue_comments SET
		comment_html=CASE WHEN $4 THEN $5 ELSE comment_html END,
		comment_stripped=CASE WHEN $4 THEN $6 ELSE comment_stripped END,
		comment_json=CASE WHEN $7 THEN $8 ELSE comment_json END,
		access=CASE WHEN $9 THEN $10 ELSE access END,
		updated_by_id=$11, updated_at=NOW()`+editedClause+`
		WHERE id::text=$1 AND issue_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL`,
		commentID, issueID, projectID,
		input.has("comment_html"), commentHTML, commentStripped,
		input.has("comment_json"), commentJSON,
		input.has("access"), valueOr(input.Access, "INTERNAL"),
		identity.UserID)
	if err != nil {
		return Comment{}, fmt.Errorf("update comment: %w", err)
	}

	// Sync description record if content changed.
	if descriptionID != "" && input.has("comment_html") && commentHTML != oldHTML {
		_, err = tx.Exec(ctx, `UPDATE descriptions SET
			description_html=$2, description_stripped=$3, description_json=$4,
			updated_by_id=$5, updated_at=NOW()
			WHERE id::text=$1`, descriptionID, commentHTML, commentStripped, commentJSON, identity.UserID)
		if err != nil {
			return Comment{}, fmt.Errorf("update comment description: %w", err)
		}
	}

	if err = recordCommentActivity(ctx, tx, issueID, commentID, projectID, identity, "comment.activity.updated"); err != nil {
		return Comment{}, err
	}

	c, err := scanComment(tx.QueryRow(ctx, `SELECT `+commentColumns+` FROM issue_comments c WHERE c.id::text=$1`, commentID))
	if err != nil {
		return Comment{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Comment{}, err
	}
	return c, nil
}

// DeleteForSession soft-deletes a comment. Only ADMIN or the creator can delete.
func (s PostgreSQLStore) DeleteForSession(ctx context.Context, sessionKey, slug, projectID, issueID, commentID string) error {
	identity, err := s.writeIdentity(ctx, sessionKey, slug, projectID)
	if err != nil {
		return err
	}
	var creatorID string
	err = s.Pool.QueryRow(ctx, `SELECT COALESCE(created_by_id::text,'') FROM issue_comments
		WHERE id::text=$1 AND issue_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL`,
		commentID, issueID, projectID).Scan(&creatorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if identity.Role < 20 && creatorID != identity.UserID {
		return ErrForbidden
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE issue_comments SET deleted_at=NOW(), updated_by_id=$4, updated_at=NOW()
		WHERE id::text=$1 AND issue_id::text=$2 AND project_id::text=$3 AND deleted_at IS NULL`,
		commentID, issueID, projectID, identity.UserID)
	if err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err = recordCommentActivity(ctx, tx, issueID, commentID, projectID, identity, "comment.activity.deleted"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// recordCommentActivity inserts an issue_activities row for comment events.
func recordCommentActivity(ctx context.Context, tx pgx.Tx, issueID, commentID, projectID string, identity writeIdentity, verb string) error {
	_, err := tx.Exec(ctx, `INSERT INTO issue_activities
		(id, issue_id, issue_comment_id, verb, field, comment, attachments, actor_id, epoch,
		 project_id, workspace_id, created_by_id, created_at, updated_at)
		VALUES ($1,$2::uuid,$3::uuid,$4,'comment',''::text,'{}'::text[],$5,$6,$7::uuid,$8::uuid,$5,NOW(),NOW())`,
		newUUID(), issueID, commentID, verb, identity.UserID, time.Now().Unix(), projectID, identity.WorkspaceID)
	if err != nil {
		return fmt.Errorf("record comment activity: %w", err)
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

func stripHTML(value string) string { return strings.TrimSpace(tagPattern.ReplaceAllString(value, "")) }
func valueOr(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return *value
}
func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
