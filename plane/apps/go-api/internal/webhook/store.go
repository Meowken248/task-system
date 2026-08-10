package webhook

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrForbidden    = errors.New("admin permission required")
	ErrNotFound     = errors.New("webhook not found")
	ErrConflict     = errors.New("URL already exists for the workspace")
)

type Webhook struct {
	ID           string     `json:"id"`
	Workspace    string     `json:"workspace,omitempty"`
	URL          string     `json:"url"`
	IsActive     bool       `json:"is_active"`
	SecretKey    string     `json:"secret_key,omitempty"`
	Project      bool       `json:"project"`
	Issue        bool       `json:"issue"`
	Module       bool       `json:"module"`
	Cycle        bool       `json:"cycle"`
	IssueComment bool       `json:"issue_comment"`
	IsInternal   bool       `json:"is_internal,omitempty"`
	Version      string     `json:"version,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	DeletedAt    *time.Time `json:"deleted_at,omitempty"`
	CreatedBy    *string    `json:"created_by,omitempty"`
	UpdatedBy    *string    `json:"updated_by,omitempty"`
}

type Log struct {
	ID              string     `json:"id"`
	Workspace       string     `json:"workspace"`
	Webhook         string     `json:"webhook"`
	EventType       *string    `json:"event_type"`
	RequestMethod   *string    `json:"request_method"`
	RequestHeaders  *string    `json:"request_headers"`
	RequestBody     *string    `json:"request_body"`
	ResponseStatus  *string    `json:"response_status"`
	ResponseHeaders *string    `json:"response_headers"`
	ResponseBody    *string    `json:"response_body"`
	RetryCount      int16      `json:"retry_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at"`
	CreatedBy       *string    `json:"created_by"`
	UpdatedBy       *string    `json:"updated_by"`
}

type Input struct {
	URL          *string
	IsActive     *bool
	Project      *bool
	Issue        *bool
	Module       *bool
	Cycle        *bool
	IssueComment *bool
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

func (s PostgreSQLStore) admin(ctx context.Context, sessionKey, slug string) (string, string, error) {
	if s.Pool == nil {
		return "", "", errors.New("database unavailable")
	}
	if sessionKey == "" {
		return "", "", ErrUnauthorized
	}
	var userID, workspaceID string
	var role int16
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, w.id::text, wm.role
		FROM sessions s JOIN users u ON u.id::text=s.user_id AND u.deleted_at IS NULL
		JOIN workspaces w ON w.slug=$2 AND w.deleted_at IS NULL
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id=u.id
			AND wm.is_active=TRUE AND wm.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey, slug).Scan(&userID, &workspaceID, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrUnauthorized
	}
	if err != nil {
		return "", "", err
	}
	if role != 20 {
		return "", "", ErrForbidden
	}
	return userID, workspaceID, nil
}

const columns = `id::text, workspace_id::text, url, is_active, secret_key, project, issue, module, cycle,
	issue_comment, is_internal, version, created_at, updated_at, deleted_at, created_by_id::text, updated_by_id::text`

type scanner interface{ Scan(...any) error }

func scan(row scanner, full bool) (Webhook, error) {
	var v Webhook
	err := row.Scan(&v.ID, &v.Workspace, &v.URL, &v.IsActive, &v.SecretKey, &v.Project, &v.Issue,
		&v.Module, &v.Cycle, &v.IssueComment, &v.IsInternal, &v.Version, &v.CreatedAt, &v.UpdatedAt,
		&v.DeletedAt, &v.CreatedBy, &v.UpdatedBy)
	if !full {
		v.Workspace, v.SecretKey, v.Version, v.CreatedBy, v.UpdatedBy = "", "", "", nil, nil
		v.IsInternal = false
	}
	return v, err
}

func (s PostgreSQLStore) List(ctx context.Context, session, slug string) ([]Webhook, error) {
	_, workspaceID, err := s.admin(ctx, session, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+columns+` FROM webhooks WHERE workspace_id::text=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Webhook, 0)
	for rows.Next() {
		item, e := scan(rows, false)
		if e != nil {
			return nil, e
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s PostgreSQLStore) Get(ctx context.Context, session, slug, id string, full bool) (Webhook, error) {
	_, workspaceID, err := s.admin(ctx, session, slug)
	if err != nil {
		return Webhook{}, err
	}
	v, err := scan(s.Pool.QueryRow(ctx, `SELECT `+columns+` FROM webhooks WHERE id::text=$1 AND workspace_id::text=$2 AND deleted_at IS NULL`, id, workspaceID), full)
	if errors.Is(err, pgx.ErrNoRows) {
		return Webhook{}, ErrNotFound
	}
	return v, err
}

func (s PostgreSQLStore) Create(ctx context.Context, session, slug string, in Input) (Webhook, error) {
	userID, workspaceID, err := s.admin(ctx, session, slug)
	if err != nil {
		return Webhook{}, err
	}
	id, secret := uuid(), "plane_wh_"+randomHex(16)
	v, err := scan(s.Pool.QueryRow(ctx, `INSERT INTO webhooks
		(id,workspace_id,url,is_active,secret_key,project,issue,module,cycle,issue_comment,is_internal,version,created_at,updated_at,deleted_at,created_by_id,updated_by_id)
		VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,'v1',NOW(),NOW(),NULL,$11::uuid,NULL) RETURNING `+columns,
		id, workspaceID, stringVal(in.URL), boolVal(in.IsActive, true), secret, boolVal(in.Project, false), boolVal(in.Issue, false),
		boolVal(in.Module, false), boolVal(in.Cycle, false), boolVal(in.IssueComment, false), userID), true)
	return v, mapConflict(err)
}

func (s PostgreSQLStore) Update(ctx context.Context, session, slug, id string, in Input) (Webhook, error) {
	userID, workspaceID, err := s.admin(ctx, session, slug)
	if err != nil {
		return Webhook{}, err
	}
	v, err := scan(s.Pool.QueryRow(ctx, `UPDATE webhooks SET
		url=CASE WHEN $3 THEN $4 ELSE url END, is_active=CASE WHEN $5 THEN $6 ELSE is_active END,
		project=CASE WHEN $7 THEN $8 ELSE project END, issue=CASE WHEN $9 THEN $10 ELSE issue END,
		module=CASE WHEN $11 THEN $12 ELSE module END, cycle=CASE WHEN $13 THEN $14 ELSE cycle END,
		issue_comment=CASE WHEN $15 THEN $16 ELSE issue_comment END, updated_at=NOW(), updated_by_id=$17::uuid
		WHERE id::text=$1 AND workspace_id::text=$2 AND deleted_at IS NULL RETURNING `+columns,
		id, workspaceID, in.URL != nil, stringVal(in.URL), in.IsActive != nil, boolVal(in.IsActive, false),
		in.Project != nil, boolVal(in.Project, false), in.Issue != nil, boolVal(in.Issue, false),
		in.Module != nil, boolVal(in.Module, false), in.Cycle != nil, boolVal(in.Cycle, false),
		in.IssueComment != nil, boolVal(in.IssueComment, false), userID), false)
	if errors.Is(err, pgx.ErrNoRows) {
		return Webhook{}, ErrNotFound
	}
	return v, mapConflict(err)
}

func (s PostgreSQLStore) Delete(ctx context.Context, session, slug, id string) error {
	userID, workspaceID, err := s.admin(ctx, session, slug)
	if err != nil {
		return err
	}
	r, err := s.Pool.Exec(ctx, `UPDATE webhooks SET deleted_at=NOW(),updated_at=NOW(),updated_by_id=$3::uuid WHERE id::text=$1 AND workspace_id::text=$2 AND deleted_at IS NULL`, id, workspaceID, userID)
	if err == nil && r.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s PostgreSQLStore) Regenerate(ctx context.Context, session, slug, id string) (Webhook, error) {
	userID, workspaceID, err := s.admin(ctx, session, slug)
	if err != nil {
		return Webhook{}, err
	}
	v, err := scan(s.Pool.QueryRow(ctx, `UPDATE webhooks SET secret_key=$3,updated_at=NOW(),updated_by_id=$4::uuid WHERE id::text=$1 AND workspace_id::text=$2 AND deleted_at IS NULL RETURNING `+columns,
		id, workspaceID, "plane_wh_"+randomHex(16), userID), true)
	if errors.Is(err, pgx.ErrNoRows) {
		return Webhook{}, ErrNotFound
	}
	return v, err
}

func (s PostgreSQLStore) Logs(ctx context.Context, session, slug, webhookID string) ([]Log, error) {
	_, workspaceID, err := s.admin(ctx, session, slug)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id::text,workspace_id::text,webhook::text,event_type,request_method,request_headers,request_body,response_status,response_headers,response_body,retry_count,created_at,updated_at,deleted_at,created_by_id::text,updated_by_id::text FROM webhook_logs WHERE workspace_id::text=$1 AND webhook::text=$2 AND deleted_at IS NULL ORDER BY created_at DESC`, workspaceID, webhookID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]Log, 0)
	for rows.Next() {
		var v Log
		if err = rows.Scan(&v.ID, &v.Workspace, &v.Webhook, &v.EventType, &v.RequestMethod, &v.RequestHeaders, &v.RequestBody, &v.ResponseStatus, &v.ResponseHeaders, &v.ResponseBody, &v.RetryCount, &v.CreatedAt, &v.UpdatedAt, &v.DeletedAt, &v.CreatedBy, &v.UpdatedBy); err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

func mapConflict(err error) error {
	var e *pgconn.PgError
	if errors.As(err, &e) && e.Code == "23505" {
		return ErrConflict
	}
	return err
}
func stringVal(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func boolVal(v *bool, fallback bool) bool {
	if v == nil {
		return fallback
	}
	return *v
}
func randomHex(n int) string { b := make([]byte, n); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func uuid() string {
	h := randomHex(16)
	return h[:8] + "-" + h[8:12] + "-4" + h[13:16] + "-a" + h[17:20] + "-" + h[20:32]
}
