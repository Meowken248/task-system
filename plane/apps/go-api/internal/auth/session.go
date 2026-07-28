package auth

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgreSQLSessionStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLSessionStore) Revoke(ctx context.Context, sessionKey, logoutIP string) error {
	if s.Pool == nil {
		return fmt.Errorf("postgres pool is not configured")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin session revocation: %w", err)
	}
	defer tx.Rollback(ctx)
	var userID *string
	err = tx.QueryRow(ctx, "SELECT user_id FROM sessions WHERE session_key = $1 FOR UPDATE", sessionKey).Scan(&userID)
	if err == nil && userID != nil && *userID != "" {
		if _, err = tx.Exec(ctx, "UPDATE users SET last_logout_time = NOW(), last_logout_ip = $2 WHERE id::text = $1", *userID, logoutIP); err != nil {
			return fmt.Errorf("update logout audit: %w", err)
		}
	}
	if _, err = tx.Exec(ctx, "DELETE FROM sessions WHERE session_key = $1", sessionKey); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit session revocation: %w", err)
	}
	return nil
}
