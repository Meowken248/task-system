package workspaceinvite

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized     = errors.New("authentication required")
	ErrForbidden        = errors.New("workspace access denied")
	ErrJoinForbidden    = errors.New("invalid invitation token")
	ErrNotFound         = errors.New("workspace invitation not found")
	ErrEmailsRequired   = errors.New("emails required")
	ErrHigherRole       = errors.New("higher invitation role")
	ErrAlreadyMember    = errors.New("workspace member already exists")
	ErrInvalidEmail     = errors.New("invalid email")
	ErrInvalidRole      = errors.New("invalid role")
	ErrAlreadyResponded = errors.New("invitation already responded")
)

type PostgreSQLStore struct {
	Pool      *pgxpool.Pool
	SecretKey string
}

type session struct {
	UserID, Email, WorkspaceID string
	Role                       int16
}

func (s PostgreSQLStore) resolveUser(ctx context.Context, sessionKey string) (string, string, error) {
	if s.Pool == nil || sessionKey == "" {
		return "", "", ErrUnauthorized
	}
	var userID, email string
	err := s.Pool.QueryRow(ctx, `SELECT u.id::text,u.email FROM sessions se JOIN users u ON u.id::text=se.user_id
		WHERE se.session_key=$1 AND se.expire_date>NOW() AND u.is_active=TRUE`, sessionKey).Scan(&userID, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrUnauthorized
	}
	return userID, email, err
}

func (s PostgreSQLStore) resolveWorkspace(ctx context.Context, sessionKey, slug string) (session, error) {
	userID, email, err := s.resolveUser(ctx, sessionKey)
	if err != nil {
		return session{}, err
	}
	var result session
	err = s.Pool.QueryRow(ctx, `SELECT $1,$2,w.id::text,wm.role FROM workspaces w
		JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.member_id::text=$1
		WHERE w.slug=$3 AND w.deleted_at IS NULL AND wm.is_active=TRUE AND wm.deleted_at IS NULL`, userID, email, slug).
		Scan(&result.UserID, &result.Email, &result.WorkspaceID, &result.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return session{}, ErrForbidden
	}
	return result, err
}

func (s PostgreSQLStore) List(ctx context.Context, sessionKey, slug string) ([]map[string]any, error) {
	current, err := s.resolveWorkspace(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	if current.Role != 15 && current.Role != 20 {
		return nil, ErrForbidden
	}
	rows, err := s.Pool.Query(ctx, inviteQuery+` WHERE i.workspace_id::text=$1 AND i.deleted_at IS NULL ORDER BY i.created_at DESC`, current.WorkspaceID)
	if err != nil {
		return nil, fmt.Errorf("list workspace invitations: %w", err)
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		item, scanErr := scanInvite(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s PostgreSQLStore) Create(ctx context.Context, sessionKey, slug string, inputs []InviteInput) error {
	if len(inputs) == 0 {
		return ErrEmailsRequired
	}
	current, err := s.resolveWorkspace(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	if current.Role != 15 && current.Role != 20 {
		return ErrForbidden
	}
	normalized := make([]InviteInput, 0, len(inputs))
	for _, input := range inputs {
		input.Email = strings.ToLower(strings.TrimSpace(input.Email))
		if input.Role == 0 {
			input.Role = 5
		}
		if input.Role != 5 && input.Role != 15 && input.Role != 20 {
			return ErrInvalidRole
		}
		if input.Role > current.Role {
			return ErrHigherRole
		}
		address, parseErr := mail.ParseAddress(input.Email)
		if parseErr != nil || !strings.EqualFold(address.Address, input.Email) || !strings.Contains(input.Email, "@") {
			return fmt.Errorf("%w - %v provided a valid email address is required to send the invite", ErrInvalidEmail, input)
		}
		normalized = append(normalized, input)
	}
	emails := make([]string, len(normalized))
	for index := range normalized {
		emails[index] = normalized[index].Email
	}
	var alreadyMember bool
	if err = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_members wm JOIN users u ON u.id=wm.member_id
		WHERE wm.workspace_id::text=$1 AND wm.is_active=TRUE AND wm.deleted_at IS NULL AND LOWER(u.email)=ANY($2))`, current.WorkspaceID, emails).Scan(&alreadyMember); err != nil {
		return fmt.Errorf("check invited workspace members: %w", err)
	}
	if alreadyMember {
		return ErrAlreadyMember
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, input := range normalized {
		id := uuid.New().String()
		token, tokenErr := s.token(input)
		if tokenErr != nil {
			return tokenErr
		}
		_, err = tx.Exec(ctx, `INSERT INTO workspace_member_invites
			(id,email,accepted,token,role,workspace_id,created_by_id,updated_by_id,created_at,updated_at)
			VALUES($1,$2,FALSE,$3,$4,$5,$6,$6,NOW(),NOW()) ON CONFLICT DO NOTHING`,
			id, input.Email, token, input.Role, current.WorkspaceID, current.UserID)
		if err != nil {
			return fmt.Errorf("create workspace invitation: %w", err)
		}
	}
	return tx.Commit(ctx)
}

func (s PostgreSQLStore) Retrieve(ctx context.Context, sessionKey, slug, invitationID string) (map[string]any, error) {
	current, err := s.resolveWorkspace(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	if current.Role != 15 && current.Role != 20 {
		return nil, ErrForbidden
	}
	return s.retrieve(ctx, current.WorkspaceID, invitationID)
}

func (s PostgreSQLStore) PublicRetrieve(ctx context.Context, slug, invitationID string) (map[string]any, error) {
	var workspaceID string
	err := s.Pool.QueryRow(ctx, `SELECT id::text FROM workspaces WHERE slug=$1 AND deleted_at IS NULL`, slug).Scan(&workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.retrieve(ctx, workspaceID, invitationID)
}

func (s PostgreSQLStore) retrieve(ctx context.Context, workspaceID, invitationID string) (map[string]any, error) {
	item, err := scanInvite(s.Pool.QueryRow(ctx, inviteQuery+` WHERE i.workspace_id::text=$1 AND i.id::text=$2 AND i.deleted_at IS NULL`, workspaceID, invitationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (s PostgreSQLStore) Update(ctx context.Context, sessionKey, slug, invitationID string, role int16) (map[string]any, error) {
	if role != 5 && role != 15 && role != 20 {
		return nil, ErrInvalidRole
	}
	current, err := s.resolveWorkspace(ctx, sessionKey, slug)
	if err != nil {
		return nil, err
	}
	if (current.Role != 15 && current.Role != 20) || role > current.Role {
		return nil, ErrForbidden
	}
	command, err := s.Pool.Exec(ctx, `UPDATE workspace_member_invites SET role=$3,updated_at=NOW(),updated_by_id=$4
		WHERE workspace_id::text=$1 AND id::text=$2 AND deleted_at IS NULL`, current.WorkspaceID, invitationID, role, current.UserID)
	if err != nil {
		return nil, err
	}
	if command.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.retrieve(ctx, current.WorkspaceID, invitationID)
}

func (s PostgreSQLStore) Delete(ctx context.Context, sessionKey, slug, invitationID string) error {
	current, err := s.resolveWorkspace(ctx, sessionKey, slug)
	if err != nil {
		return err
	}
	if current.Role != 15 && current.Role != 20 {
		return ErrForbidden
	}
	command, err := s.Pool.Exec(ctx, `UPDATE workspace_member_invites SET deleted_at=NOW(),updated_at=NOW(),updated_by_id=$3
		WHERE workspace_id::text=$1 AND id::text=$2 AND deleted_at IS NULL`, current.WorkspaceID, invitationID, current.UserID)
	if err == nil && command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s PostgreSQLStore) Join(ctx context.Context, slug, invitationID, token string, accepted bool) (string, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id, email, workspaceID, storedToken string
	var role int16
	var respondedAt *time.Time
	err = tx.QueryRow(ctx, `SELECT i.id::text,i.email,i.workspace_id::text,i.token,i.role,i.responded_at
		FROM workspace_member_invites i JOIN workspaces w ON w.id=i.workspace_id
		WHERE i.id::text=$1 AND w.slug=$2 AND i.deleted_at IS NULL FOR UPDATE`, invitationID, slug).
		Scan(&id, &email, &workspaceID, &storedToken, &role, &respondedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if token == "" || token != storedToken {
		return "", ErrJoinForbidden
	}
	if respondedAt != nil {
		return "", ErrAlreadyResponded
	}
	if _, err = tx.Exec(ctx, `UPDATE workspace_member_invites SET accepted=$2,responded_at=NOW(),updated_at=NOW() WHERE id::text=$1`, id, accepted); err != nil {
		return "", err
	}
	if !accepted {
		if err = tx.Commit(ctx); err != nil {
			return "", err
		}
		return "Workspace Invitation was not accepted", nil
	}
	var userID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM users WHERE LOWER(email)=LOWER($1) AND deleted_at IS NULL LIMIT 1`, email).Scan(&userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if err == nil {
		if _, err = tx.Exec(ctx, `INSERT INTO workspace_members
			(id,role,is_active,workspace_id,member_id,created_by_id,updated_by_id,created_at,updated_at)
			VALUES($1,$2,TRUE,$3,$4,$4,$4,NOW(),NOW())
			ON CONFLICT (workspace_id,member_id) WHERE deleted_at IS NULL
			DO UPDATE SET is_active=TRUE,role=EXCLUDED.role,updated_at=NOW()`, uuid.New().String(), role, workspaceID, userID); err != nil {
			return "", err
		}
		if _, err = tx.Exec(ctx, `UPDATE users SET last_workspace_id=$2,updated_at=NOW() WHERE id::text=$1`, userID, workspaceID); err != nil {
			return "", err
		}
		if _, err = tx.Exec(ctx, `UPDATE workspace_member_invites SET deleted_at=NOW(),updated_at=NOW() WHERE id::text=$1`, id); err != nil {
			return "", err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return "Workspace Invitation Accepted", nil
}

func (s PostgreSQLStore) ListForUser(ctx context.Context, sessionKey string) ([]map[string]any, error) {
	_, email, err := s.resolveUser(ctx, sessionKey)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, inviteQuery+` WHERE LOWER(i.email)=LOWER($1) AND i.deleted_at IS NULL ORDER BY i.created_at DESC`, email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]map[string]any, 0)
	for rows.Next() {
		item, scanErr := scanInvite(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s PostgreSQLStore) JoinForUser(ctx context.Context, sessionKey string, invitationIDs []string) error {
	userID, email, err := s.resolveUser(ctx, sessionKey)
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, `SELECT id::text,workspace_id::text,role FROM workspace_member_invites
		WHERE id::text=ANY($1) AND LOWER(email)=LOWER($2) AND deleted_at IS NULL ORDER BY created_at DESC FOR UPDATE`, invitationIDs, email)
	if err != nil {
		return err
	}
	type invitation struct {
		ID, WorkspaceID string
		Role            int16
	}
	items := make([]invitation, 0)
	for rows.Next() {
		var item invitation
		if err = rows.Scan(&item.ID, &item.WorkspaceID, &item.Role); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		if _, err = tx.Exec(ctx, `INSERT INTO workspace_members
			(id,role,is_active,workspace_id,member_id,created_by_id,updated_by_id,created_at,updated_at)
			VALUES($1,$2,TRUE,$3,$4,$4,$4,NOW(),NOW())
			ON CONFLICT (workspace_id,member_id) WHERE deleted_at IS NULL
			DO UPDATE SET is_active=TRUE,role=EXCLUDED.role,updated_at=NOW()`, uuid.New().String(), item.Role, item.WorkspaceID, userID); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE workspace_member_invites SET deleted_at=NOW(),updated_at=NOW() WHERE id::text=$1`, item.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s PostgreSQLStore) token(input InviteInput) (string, error) {
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload, err := json.Marshal(map[string]any{"email": input, "timestamp": float64(time.Now().UnixNano()) / 1e9})
	if err != nil {
		return "", err
	}
	encode := base64.RawURLEncoding.EncodeToString
	unsigned := encode(header) + "." + encode(payload)
	mac := hmac.New(sha256.New, []byte(s.SecretKey))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + encode(mac.Sum(nil)), nil
}

const inviteQuery = `SELECT i.id::text,i.email,i.accepted,i.token,i.message,i.responded_at,i.role,
	i.created_at,i.updated_at,i.created_by_id::text,i.updated_by_id::text,i.deleted_at,
	w.id::text,w.name,w.slug,w.logo,w.logo_asset_id::text
	FROM workspace_member_invites i JOIN workspaces w ON w.id=i.workspace_id AND w.deleted_at IS NULL`

type rowScanner interface{ Scan(...any) error }

func scanInvite(row rowScanner) (map[string]any, error) {
	var id, email, token, workspaceID, workspaceName, workspaceSlug string
	var accepted bool
	var message, createdBy, updatedBy, logo, logoAsset *string
	var respondedAt, deletedAt *time.Time
	var role int16
	var createdAt, updatedAt time.Time
	if err := row.Scan(&id, &email, &accepted, &token, &message, &respondedAt, &role, &createdAt, &updatedAt,
		&createdBy, &updatedBy, &deletedAt, &workspaceID, &workspaceName, &workspaceSlug, &logo, &logoAsset); err != nil {
		return nil, err
	}
	logoURL := any(logo)
	if logoAsset != nil && *logoAsset != "" {
		logoURL = "/api/assets/v2/static/" + *logoAsset + "/"
	}
	return map[string]any{
		"id": id, "email": email, "accepted": accepted, "token": token, "message": message,
		"responded_at": respondedAt, "role": role, "created_at": createdAt, "updated_at": updatedAt,
		"created_by": createdBy, "updated_by": updatedBy, "deleted_at": deletedAt,
		"workspace":   map[string]any{"id": workspaceID, "name": workspaceName, "slug": workspaceSlug, "logo_url": logoURL},
		"invite_link": "/workspace-invitations/?invitation_id=" + id + "&slug=" + workspaceSlug + "&token=" + token,
	}, nil
}
