package apitoken

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnauthorized = errors.New("authentication required")
	ErrNotFound     = errors.New("API token not found")
	ErrInvalid      = errors.New("invalid API token")
)

type Token struct {
	ID               string     `json:"id"`
	Label            string     `json:"label"`
	Description      string     `json:"description"`
	IsActive         bool       `json:"is_active"`
	LastUsed         *time.Time `json:"last_used"`
	Token            *string    `json:"token,omitempty"`
	User             string     `json:"user"`
	UserType         int16      `json:"user_type"`
	Workspace        *string    `json:"workspace"`
	ExpiredAt        *time.Time `json:"expired_at"`
	IsService        bool       `json:"is_service"`
	AllowedRateLimit string     `json:"allowed_rate_limit"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	DeletedAt        *time.Time `json:"deleted_at"`
	CreatedBy        *string    `json:"created_by"`
	UpdatedBy        *string    `json:"updated_by"`
}

type CreateInput struct {
	Label       *string
	Description *string
	ExpiredAt   *time.Time
}

type UpdateInput struct {
	Label            *string
	Description      *string
	IsService        *bool
	AllowedRateLimit *string
}

type PostgreSQLStore struct{ Pool *pgxpool.Pool }

type identity struct {
	UserID string
	IsBot  bool
}

func (s PostgreSQLStore) identity(ctx context.Context, sessionKey string) (identity, error) {
	if s.Pool == nil {
		return identity{}, errors.New("database unavailable")
	}
	if sessionKey == "" {
		return identity{}, ErrUnauthorized
	}
	var result identity
	err := s.Pool.QueryRow(ctx, `SELECT s.user_id, u.is_bot
		FROM sessions s JOIN users u ON u.id::text=s.user_id AND u.deleted_at IS NULL
		WHERE s.session_key=$1 AND s.expire_date>NOW()`, sessionKey).Scan(&result.UserID, &result.IsBot)
	if errors.Is(err, pgx.ErrNoRows) {
		return identity{}, ErrUnauthorized
	}
	return result, err
}

const tokenColumns = `id::text, label, COALESCE(description,''), is_active, last_used, token,
	user_id::text, user_type, workspace_id::text, expired_at, is_service, allowed_rate_limit,
	created_at, updated_at, deleted_at, created_by_id::text, updated_by_id::text`

type rowScanner interface{ Scan(...any) error }

func scanToken(row rowScanner, exposeToken, computeActive bool) (Token, error) {
	var item Token
	var secret string
	err := row.Scan(&item.ID, &item.Label, &item.Description, &item.IsActive, &item.LastUsed, &secret,
		&item.User, &item.UserType, &item.Workspace, &item.ExpiredAt, &item.IsService, &item.AllowedRateLimit,
		&item.CreatedAt, &item.UpdatedAt, &item.DeletedAt, &item.CreatedBy, &item.UpdatedBy)
	if err != nil {
		return Token{}, err
	}
	if exposeToken {
		item.Token = &secret
	}
	if computeActive {
		item.IsActive = item.ExpiredAt == nil || time.Now().Before(*item.ExpiredAt)
	}
	return item, nil
}

func (s PostgreSQLStore) List(ctx context.Context, sessionKey string) ([]Token, error) {
	id, err := s.identity(ctx, sessionKey)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT `+tokenColumns+` FROM api_tokens
		WHERE user_id::text=$1 AND is_service=FALSE AND deleted_at IS NULL ORDER BY created_at DESC`, id.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Token, 0)
	for rows.Next() {
		item, scanErr := scanToken(rows, false, true)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s PostgreSQLStore) Create(ctx context.Context, sessionKey string, input CreateInput) (Token, error) {
	id, err := s.identity(ctx, sessionKey)
	if err != nil {
		return Token{}, err
	}
	label := randomHex(16)
	if input.Label != nil {
		label = strings.TrimSpace(*input.Label)
	}
	if label == "" || len(label) > 255 {
		return Token{}, fmt.Errorf("%w: label must contain 1 to 255 characters", ErrInvalid)
	}
	description := ""
	if input.Description != nil {
		description = *input.Description
	}
	tokenID, secret := randomUUID(), "plane_api_"+randomHex(16)
	userType := int16(0)
	if id.IsBot {
		userType = 1
	}
	row := s.Pool.QueryRow(ctx, `INSERT INTO api_tokens
		(id,label,description,is_active,last_used,token,user_id,user_type,workspace_id,expired_at,is_service,allowed_rate_limit,
		 created_at,updated_at,deleted_at,created_by_id,updated_by_id)
		VALUES ($1::uuid,$2,$3,TRUE,NULL,$4,$5::uuid,$6,NULL,$7,FALSE,'60/min',NOW(),NOW(),NULL,$5::uuid,NULL)
		RETURNING `+tokenColumns, tokenID, label, description, secret, id.UserID, userType, input.ExpiredAt)
	return scanToken(row, true, false)
}

func (s PostgreSQLStore) Retrieve(ctx context.Context, sessionKey, tokenID string, exposeToken bool) (Token, error) {
	id, err := s.identity(ctx, sessionKey)
	if err != nil {
		return Token{}, err
	}
	item, err := scanToken(s.Pool.QueryRow(ctx, `SELECT `+tokenColumns+` FROM api_tokens
		WHERE id::text=$1 AND user_id::text=$2 AND deleted_at IS NULL`, tokenID, id.UserID), exposeToken, !exposeToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return Token{}, ErrNotFound
	}
	return item, err
}

func (s PostgreSQLStore) Update(ctx context.Context, sessionKey, tokenID string, input UpdateInput) (Token, error) {
	id, err := s.identity(ctx, sessionKey)
	if err != nil {
		return Token{}, err
	}
	if input.Label != nil && (strings.TrimSpace(*input.Label) == "" || len(strings.TrimSpace(*input.Label)) > 255) {
		return Token{}, fmt.Errorf("%w: label must contain 1 to 255 characters", ErrInvalid)
	}
	if input.AllowedRateLimit != nil && len(*input.AllowedRateLimit) > 255 {
		return Token{}, fmt.Errorf("%w: allowed_rate_limit is too long", ErrInvalid)
	}
	item, err := scanToken(s.Pool.QueryRow(ctx, `UPDATE api_tokens SET
		label=CASE WHEN $3::boolean THEN $4 ELSE label END,
		description=CASE WHEN $5::boolean THEN $6 ELSE description END,
		is_service=CASE WHEN $7::boolean THEN $8 ELSE is_service END,
		allowed_rate_limit=CASE WHEN $9::boolean THEN $10 ELSE allowed_rate_limit END,
		updated_at=NOW(), updated_by_id=$2::uuid
		WHERE id::text=$1 AND user_id::text=$2 AND deleted_at IS NULL RETURNING `+tokenColumns,
		tokenID, id.UserID, input.Label != nil, stringValue(input.Label), input.Description != nil,
		stringValue(input.Description), input.IsService != nil, boolValue(input.IsService),
		input.AllowedRateLimit != nil, stringValue(input.AllowedRateLimit)), true, false)
	if errors.Is(err, pgx.ErrNoRows) {
		return Token{}, ErrNotFound
	}
	return item, err
}

func (s PostgreSQLStore) Delete(ctx context.Context, sessionKey, tokenID string) error {
	id, err := s.identity(ctx, sessionKey)
	if err != nil {
		return err
	}
	result, err := s.Pool.Exec(ctx, `UPDATE api_tokens SET deleted_at=NOW(), updated_at=NOW(), updated_by_id=$2::uuid
		WHERE id::text=$1 AND user_id::text=$2 AND is_service=FALSE AND deleted_at IS NULL`, tokenID, id.UserID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func boolValue(value *bool) bool { return value != nil && *value }

func randomHex(size int) string {
	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		panic(err)
	}
	return hex.EncodeToString(data)
}

func randomUUID() string {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		panic(err)
	}
	data[6] = (data[6] & 0x0f) | 0x40
	data[8] = (data[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", data[0:4], data[4:6], data[6:8], data[8:10], data[10:16])
}
