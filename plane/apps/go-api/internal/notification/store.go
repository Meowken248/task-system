package notification

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	ErrNotFound     = errors.New("notification not found")
)

type UserLite struct {
	ID          string  `json:"id"`
	FirstName   string  `json:"first_name"`
	LastName    string  `json:"last_name"`
	DisplayName string  `json:"display_name"`
	Avatar      *string `json:"avatar"`
}

type Notification struct {
	ID                      string     `json:"id"`
	WorkspaceID             string     `json:"workspace"`
	ProjectID               *string    `json:"project"`
	Data                    any        `json:"data"`
	EntityIdentifier        *string    `json:"entity_identifier"`
	EntityName              string     `json:"entity_name"`
	Title                   string     `json:"title"`
	Message                 any        `json:"message"`
	MessageHTML             string     `json:"message_html"`
	MessageStripped         *string    `json:"message_stripped"`
	Sender                  string     `json:"sender"`
	TriggeredByID           *string    `json:"triggered_by"`
	TriggeredByDetails      *UserLite  `json:"triggered_by_details"`
	ReceiverID              string     `json:"receiver"`
	ReadAt                  *time.Time `json:"read_at"`
	SnoozedTill             *time.Time `json:"snoozed_till"`
	ArchivedAt              *time.Time `json:"archived_at"`
	CreatedAt               time.Time  `json:"created_at"`
	UpdatedAt               time.Time  `json:"updated_at"`
	IsInboxIssue            bool       `json:"is_inbox_issue"`
	IsIntakeIssue           bool       `json:"is_intake_issue"`
	IsMentionedNotification bool       `json:"is_mentioned_notification"`
}

type ListOptions struct {
	Read      *bool
	Archived  bool
	Snoozed   bool
	Mentioned bool
	Limit     int
}

type Store interface {
	ListForSession(context.Context, string, string, ListOptions) ([]Notification, int, error)
	UnreadCounts(context.Context, string, string) (int, int, error)
	UpdateForSession(context.Context, string, string, string, *time.Time) (Notification, error)
	SetReadForSession(context.Context, string, string, string, bool) (Notification, error)
	SetArchivedForSession(context.Context, string, string, string, bool) (Notification, error)
	MarkAllReadForSession(context.Context, string, string, ListOptions) (int64, error)
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) identity(ctx context.Context, sessionKey, slug string) (string, string, error) {
	var userID, workspaceID string
	err := s.Pool.QueryRow(ctx, `
		SELECT session.user_id::text, workspace.id::text
		FROM sessions session
		JOIN workspaces workspace ON workspace.slug = $2
		JOIN workspace_members member
		  ON member.workspace_id = workspace.id
		 AND member.member_id = NULLIF(session.user_id, '')::uuid
		 AND member.is_active = TRUE
		WHERE session.session_key = $1 AND session.expire_date > NOW()
		LIMIT 1
	`, sessionKey, slug).Scan(&userID, &workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		var valid bool
		if checkErr := s.Pool.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM sessions WHERE session_key=$1 AND expire_date>NOW())
		`, sessionKey).Scan(&valid); checkErr != nil {
			return "", "", checkErr
		}
		if !valid {
			return "", "", ErrUnauthorized
		}
		return "", "", ErrForbidden
	}
	return userID, workspaceID, err
}

func (s PostgreSQLStore) ListForSession(ctx context.Context, sessionKey, slug string, options ListOptions) ([]Notification, int, error) {
	userID, workspaceID, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return nil, 0, err
	}
	limit := options.Limit
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	filterArgs := []any{userID, workspaceID, options.Read, options.Archived, options.Snoozed, options.Mentioned}
	filterSQL := `
		FROM notifications n
		WHERE n.receiver_id::text = $1 AND n.workspace_id::text = $2
		  AND n.entity_name = 'issue'
		  AND ($3::boolean IS NULL OR (n.read_at IS NOT NULL) = $3)
		  AND ((NOT $4 AND n.archived_at IS NULL) OR ($4 AND n.archived_at IS NOT NULL))
		  AND ((NOT $5 AND (n.snoozed_till IS NULL OR n.snoozed_till >= NOW()))
		       OR ($5 AND n.snoozed_till IS NOT NULL))
		  AND ((NOT $6 AND n.sender NOT ILIKE '%mentioned%')
		       OR ($6 AND n.sender ILIKE '%mentioned%'))`
	var total int
	if err = s.Pool.QueryRow(ctx, "SELECT COUNT(*) "+filterSQL, filterArgs...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT n.id::text, n.workspace_id::text, n.project_id::text, n.data,
		       n.entity_identifier::text, n.entity_name, n.title, n.message,
		       n.message_html, n.message_stripped, n.sender, n.triggered_by_id::text,
		       n.receiver_id::text, n.read_at, n.snoozed_till, n.archived_at,
		       n.created_at, n.updated_at,
		       u.id::text, u.first_name, u.last_name, u.display_name, u.avatar
		FROM notifications n
		LEFT JOIN users u ON u.id = n.triggered_by_id
		WHERE n.receiver_id::text = $1 AND n.workspace_id::text = $2
		  AND n.entity_name = 'issue'
		  AND ($3::boolean IS NULL OR (n.read_at IS NOT NULL) = $3)
		  AND ((NOT $4 AND n.archived_at IS NULL) OR ($4 AND n.archived_at IS NOT NULL))
		  AND ((NOT $5 AND (n.snoozed_till IS NULL OR n.snoozed_till >= NOW()))
		       OR ($5 AND n.snoozed_till IS NOT NULL))
		  AND ((NOT $6 AND n.sender NOT ILIKE '%mentioned%')
		       OR ($6 AND n.sender ILIKE '%mentioned%'))
		ORDER BY n.snoozed_till NULLS FIRST, n.created_at DESC
		LIMIT $7
	`, append(filterArgs, limit)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	results := make([]Notification, 0)
	for rows.Next() {
		var n Notification
		var triggeredID, firstName, lastName, displayName *string
		var avatar *string
		if err = rows.Scan(
			&n.ID, &n.WorkspaceID, &n.ProjectID, &n.Data,
			&n.EntityIdentifier, &n.EntityName, &n.Title, &n.Message,
			&n.MessageHTML, &n.MessageStripped, &n.Sender, &n.TriggeredByID,
			&n.ReceiverID, &n.ReadAt, &n.SnoozedTill, &n.ArchivedAt,
			&n.CreatedAt, &n.UpdatedAt,
			&triggeredID, &firstName, &lastName, &displayName, &avatar,
		); err != nil {
			return nil, 0, err
		}
		n.IsMentionedNotification = containsMention(n.Sender)
		if triggeredID != nil {
			n.TriggeredByDetails = &UserLite{ID: *triggeredID}
			if firstName != nil {
				n.TriggeredByDetails.FirstName = *firstName
			}
			if lastName != nil {
				n.TriggeredByDetails.LastName = *lastName
			}
			if displayName != nil {
				n.TriggeredByDetails.DisplayName = *displayName
			}
			n.TriggeredByDetails.Avatar = avatar
		}
		results = append(results, n)
	}
	if err = rows.Err(); err != nil {
		return nil, 0, err
	}
	return results, total, nil
}

func (s PostgreSQLStore) UnreadCounts(ctx context.Context, sessionKey, slug string) (int, int, error) {
	userID, workspaceID, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return 0, 0, err
	}
	var total, mentions int
	err = s.Pool.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE sender NOT ILIKE '%mentioned%'),
		  COUNT(*) FILTER (WHERE sender ILIKE '%mentioned%')
		FROM notifications
		WHERE receiver_id::text=$1 AND workspace_id::text=$2
		  AND read_at IS NULL AND archived_at IS NULL AND snoozed_till IS NULL
	`, userID, workspaceID).Scan(&total, &mentions)
	return total, mentions, err
}

func (s PostgreSQLStore) UpdateForSession(ctx context.Context, sessionKey, slug, notificationID string, snoozedTill *time.Time) (Notification, error) {
	return s.update(ctx, sessionKey, slug, notificationID, "snoozed_till", snoozedTill)
}

func (s PostgreSQLStore) SetReadForSession(ctx context.Context, sessionKey, slug, notificationID string, read bool) (Notification, error) {
	var value any
	if read {
		value = time.Now()
	}
	return s.update(ctx, sessionKey, slug, notificationID, "read_at", value)
}

func (s PostgreSQLStore) SetArchivedForSession(ctx context.Context, sessionKey, slug, notificationID string, archived bool) (Notification, error) {
	var value any
	if archived {
		value = time.Now()
	}
	return s.update(ctx, sessionKey, slug, notificationID, "archived_at", value)
}

func (s PostgreSQLStore) update(ctx context.Context, sessionKey, slug, notificationID, column string, value any) (Notification, error) {
	userID, workspaceID, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return Notification{}, err
	}
	query := "UPDATE notifications SET " + column + "=$4, updated_at=NOW() WHERE id::text=$3 AND receiver_id::text=$1 AND workspace_id::text=$2 RETURNING id::text"
	var id string
	if err = s.Pool.QueryRow(ctx, query, userID, workspaceID, notificationID, value).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
		return Notification{}, ErrNotFound
	} else if err != nil {
		return Notification{}, err
	}
	items, err := s.listByID(ctx, userID, workspaceID, id)
	if err != nil {
		return Notification{}, err
	}
	if len(items) == 0 {
		return Notification{}, ErrNotFound
	}
	return items[0], nil
}

func (s PostgreSQLStore) listByID(ctx context.Context, userID, workspaceID, notificationID string) ([]Notification, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id::text, workspace_id::text, project_id::text, data,
		       entity_identifier::text, entity_name, title, message, message_html,
		       message_stripped, sender, triggered_by_id::text, receiver_id::text,
		       read_at, snoozed_till, archived_at, created_at, updated_at
		FROM notifications
		WHERE id::text=$3 AND receiver_id::text=$1 AND workspace_id::text=$2
	`, userID, workspaceID, notificationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Notification, 0, 1)
	for rows.Next() {
		var n Notification
		if err = rows.Scan(
			&n.ID, &n.WorkspaceID, &n.ProjectID, &n.Data, &n.EntityIdentifier,
			&n.EntityName, &n.Title, &n.Message, &n.MessageHTML, &n.MessageStripped,
			&n.Sender, &n.TriggeredByID, &n.ReceiverID, &n.ReadAt, &n.SnoozedTill,
			&n.ArchivedAt, &n.CreatedAt, &n.UpdatedAt,
		); err != nil {
			return nil, err
		}
		n.IsMentionedNotification = containsMention(n.Sender)
		items = append(items, n)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) MarkAllReadForSession(ctx context.Context, sessionKey, slug string, options ListOptions) (int64, error) {
	userID, workspaceID, err := s.identity(ctx, sessionKey, slug)
	if err != nil {
		return 0, err
	}
	result, err := s.Pool.Exec(ctx, `
		UPDATE notifications SET read_at=NOW(), updated_at=NOW()
		WHERE receiver_id::text=$1 AND workspace_id::text=$2 AND read_at IS NULL
		  AND ((NOT $3 AND archived_at IS NULL) OR ($3 AND archived_at IS NOT NULL))
		  AND ((NOT $4 AND (snoozed_till IS NULL OR snoozed_till >= NOW()))
		       OR ($4 AND snoozed_till IS NOT NULL))
	`, userID, workspaceID, options.Archived, options.Snoozed)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

func containsMention(value string) bool {
	return strings.Contains(strings.ToLower(value), "mentioned")
}
