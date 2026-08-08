package instance

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/makeplane/plane/apps/go-api/internal/auth"
)

type Instance struct {
	ID                         string    `json:"id"`
	InstanceName               string    `json:"instance_name"`
	WhitelistEmails            *string   `json:"whitelist_emails"`
	InstanceID                 string    `json:"instance_id"`
	CurrentVersion             string    `json:"current_version"`
	LatestVersion              *string   `json:"latest_version"`
	Edition                    string    `json:"edition"`
	Domain                     string    `json:"domain"`
	LastCheckedAt              time.Time `json:"last_checked_at"`
	Namespace                  *string   `json:"namespace"`
	IsTelemetryEnabled         bool      `json:"is_telemetry_enabled"`
	IsSupportRequired          bool      `json:"is_support_required"`
	IsSetupDone                bool      `json:"is_setup_done"`
	IsSignupScreenVisited      bool      `json:"is_signup_screen_visited"`
	IsVerified                 bool      `json:"is_verified"`
	IsTest                     bool      `json:"is_test"`
	IsCurrentVersionDeprecated bool      `json:"is_current_version_deprecated"`
	CreatedAt                  time.Time `json:"created_at"`
	UpdatedAt                  time.Time `json:"updated_at"`
}

type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Password  string    `json:"-"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	IsActive  bool      `json:"is_active"`
	IsBot     bool      `json:"is_bot"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type InstanceAdmin struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	InstanceID string    `json:"instance_id"`
	Role       int       `json:"role"`
	IsVerified bool      `json:"is_verified"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type InstanceConfiguration struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Value       *string   `json:"value"`
	Category    string    `json:"category"`
	IsEncrypted bool      `json:"is_encrypted"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Store interface {
	GetInstance(ctx context.Context) (*Instance, error)
	CreateInstance(ctx context.Context, instance *Instance) error
	UpdateInstance(ctx context.Context, instance *Instance) error

	CreateUser(ctx context.Context, user *User) error
	GetUserByEmail(ctx context.Context, email string) (*User, error)
	GetUserByID(ctx context.Context, id string) (*User, error)

	CreateInstanceAdmin(ctx context.Context, admin *InstanceAdmin) error
	GetInstanceAdmins(context.Context) ([]InstanceAdmin, error)
	GetInstanceAdminByUserID(context.Context, string) (*InstanceAdmin, error)
	DeleteInstanceAdmin(context.Context, string) error
	GetConfigurations(context.Context) ([]InstanceConfiguration, error)
	UpdateConfiguration(context.Context, *InstanceConfiguration) error
	GetUserIDBySessionKey(context.Context, string) (string, error)
	CreateLoginSession(context.Context, auth.LoginSession) error
}

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) CreateLoginSession(ctx context.Context, session auth.LoginSession) error {
	return (auth.PostgreSQLSignInStore{Pool: s.Pool}).CreateLoginSession(ctx, session)
}

func (s PostgreSQLStore) GetUserIDBySessionKey(ctx context.Context, sessionKey string) (string, error) {
	if sessionKey == "" {
		return "", errors.New("unauthorized")
	}
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key = $1 AND expire_date > NOW()`, sessionKey).Scan(&userID)
	if err != nil {
		return "", err
	}
	return userID, nil
}

func (s PostgreSQLStore) GetInstance(ctx context.Context) (*Instance, error) {
	query := `
		SELECT id, instance_name, whitelist_emails, instance_id, current_version, latest_version,
		       edition, domain, last_checked_at, namespace, is_telemetry_enabled, is_support_required,
		       is_setup_done, is_signup_screen_visited, is_verified, is_test, is_current_version_deprecated,
		       created_at, updated_at
		FROM instances
		ORDER BY created_at DESC
		LIMIT 1
	`
	var i Instance
	err := s.Pool.QueryRow(ctx, query).Scan(
		&i.ID, &i.InstanceName, &i.WhitelistEmails, &i.InstanceID, &i.CurrentVersion, &i.LatestVersion,
		&i.Edition, &i.Domain, &i.LastCheckedAt, &i.Namespace, &i.IsTelemetryEnabled, &i.IsSupportRequired,
		&i.IsSetupDone, &i.IsSignupScreenVisited, &i.IsVerified, &i.IsTest, &i.IsCurrentVersionDeprecated,
		&i.CreatedAt, &i.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &i, nil
}

func (s PostgreSQLStore) CreateInstance(ctx context.Context, i *Instance) error {
	query := `
		INSERT INTO instances (
			instance_name, whitelist_emails, instance_id, current_version, latest_version,
			edition, domain, namespace, is_telemetry_enabled, is_support_required,
			is_setup_done, is_signup_screen_visited, is_verified, is_test, is_current_version_deprecated
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
		) RETURNING id, created_at, updated_at, last_checked_at
	`
	return s.Pool.QueryRow(ctx, query,
		i.InstanceName, i.WhitelistEmails, i.InstanceID, i.CurrentVersion, i.LatestVersion,
		i.Edition, i.Domain, i.Namespace, i.IsTelemetryEnabled, i.IsSupportRequired,
		i.IsSetupDone, i.IsSignupScreenVisited, i.IsVerified, i.IsTest, i.IsCurrentVersionDeprecated,
	).Scan(&i.ID, &i.CreatedAt, &i.UpdatedAt, &i.LastCheckedAt)
}

func (s PostgreSQLStore) UpdateInstance(ctx context.Context, i *Instance) error {
	query := `
		UPDATE instances SET
			instance_name = $1, whitelist_emails = $2, current_version = $3, latest_version = $4,
			edition = $5, domain = $6, namespace = $7, is_telemetry_enabled = $8, is_support_required = $9,
			is_setup_done = $10, is_signup_screen_visited = $11, is_verified = $12, is_test = $13,
			is_current_version_deprecated = $14, updated_at = NOW()
		WHERE id = $15
		RETURNING updated_at
	`
	return s.Pool.QueryRow(ctx, query,
		i.InstanceName, i.WhitelistEmails, i.CurrentVersion, i.LatestVersion,
		i.Edition, i.Domain, i.Namespace, i.IsTelemetryEnabled, i.IsSupportRequired,
		i.IsSetupDone, i.IsSignupScreenVisited, i.IsVerified, i.IsTest,
		i.IsCurrentVersionDeprecated, i.ID,
	).Scan(&i.UpdatedAt)
}

func (s PostgreSQLStore) CreateUser(ctx context.Context, u *User) error {
	query := `
		INSERT INTO users (
			id, username, email, password, first_name, last_name, is_active, is_bot,
			avatar, date_joined, created_at, updated_at, last_location, created_location,
			is_superuser, is_managed, is_password_expired, is_staff, is_email_verified,
			is_password_autoset, token, user_timezone, last_login_ip, last_logout_ip,
			last_login_medium, last_login_uagent, is_email_valid, is_password_reset_required, display_name
		) VALUES (
			gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7,
			'', NOW(), NOW(), NOW(), '', '',
			false, false, false, false, false,
			false, '', 'UTC', '', '',
			'email', '', false, false, ''
		)
		RETURNING id, created_at, updated_at
	`
	return s.Pool.QueryRow(ctx, query,
		u.Username, u.Email, u.Password, u.FirstName, u.LastName, u.IsActive, u.IsBot,
	).Scan(&u.ID, &u.CreatedAt, &u.UpdatedAt)
}

func (s PostgreSQLStore) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	query := `SELECT id, username, email, password, first_name, last_name, is_active, is_bot, created_at, updated_at FROM users WHERE email = $1`
	err := s.Pool.QueryRow(ctx, query, email).Scan(
		&u.ID, &u.Username, &u.Email, &u.Password, &u.FirstName, &u.LastName, &u.IsActive, &u.IsBot, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s PostgreSQLStore) GetUserByID(ctx context.Context, id string) (*User, error) {
	var u User
	query := `SELECT id, username, email, password, first_name, last_name, is_active, is_bot, created_at, updated_at FROM users WHERE id = $1`
	err := s.Pool.QueryRow(ctx, query, id).Scan(
		&u.ID, &u.Username, &u.Email, &u.Password, &u.FirstName, &u.LastName, &u.IsActive, &u.IsBot, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s PostgreSQLStore) CreateInstanceAdmin(ctx context.Context, a *InstanceAdmin) error {
	query := `
		INSERT INTO instance_admins (id, user_id, instance_id, role, is_verified, created_at, updated_at)
		VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
		RETURNING id, created_at, updated_at
	`
	return s.Pool.QueryRow(ctx, query, a.UserID, a.InstanceID, a.Role, a.IsVerified).Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt)
}

func (s PostgreSQLStore) GetInstanceAdmins(ctx context.Context) ([]InstanceAdmin, error) {
	query := `SELECT id, user_id, instance_id, role, is_verified, created_at, updated_at FROM instance_admins ORDER BY created_at DESC`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var admins []InstanceAdmin
	for rows.Next() {
		var a InstanceAdmin
		if err := rows.Scan(&a.ID, &a.UserID, &a.InstanceID, &a.Role, &a.IsVerified, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		admins = append(admins, a)
	}
	return admins, nil
}

func (s PostgreSQLStore) GetInstanceAdminByUserID(ctx context.Context, userID string) (*InstanceAdmin, error) {
	query := `SELECT id, user_id, instance_id, role, is_verified, created_at, updated_at FROM instance_admins WHERE user_id = $1`
	var a InstanceAdmin
	err := s.Pool.QueryRow(ctx, query, userID).Scan(&a.ID, &a.UserID, &a.InstanceID, &a.Role, &a.IsVerified, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s PostgreSQLStore) DeleteInstanceAdmin(ctx context.Context, id string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM instance_admins WHERE id = $1`, id)
	return err
}

func (s PostgreSQLStore) GetConfigurations(ctx context.Context) ([]InstanceConfiguration, error) {
	query := `SELECT id, key, value, category, is_encrypted, created_at, updated_at FROM instance_configurations`
	rows, err := s.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var configs []InstanceConfiguration
	for rows.Next() {
		var c InstanceConfiguration
		if err := rows.Scan(&c.ID, &c.Key, &c.Value, &c.Category, &c.IsEncrypted, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		configs = append(configs, c)
	}
	return configs, nil
}

func (s PostgreSQLStore) UpdateConfiguration(ctx context.Context, c *InstanceConfiguration) error {
	query := `
		INSERT INTO instance_configurations (key, value, category, is_encrypted)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, category = EXCLUDED.category, is_encrypted = EXCLUDED.is_encrypted, updated_at = NOW()
		RETURNING id, created_at, updated_at
	`
	return s.Pool.QueryRow(ctx, query, c.Key, c.Value, c.Category, c.IsEncrypted).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
}
