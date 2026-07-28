package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

func (s PostgreSQLStore) ProfileForSession(ctx context.Context, sessionKey string) (map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("user database unavailable")
	}
	userID, err := s.authenticatedUserID(ctx, sessionKey)
	if err != nil {
		return nil, err
	}
	var id, user, language, backgroundColor, notificationViewMode string
	var role, useCase, lastWorkspaceID, companyName, billingCountry *string
	var createdAt, updatedAt any
	var themeRaw, onboardingRaw, billingRaw, mobileOnboardingRaw, goalsRaw, productTourRaw []byte
	var appRailDocked, tourCompleted, onboarded, hasBilling, smoothCursor, mobileOnboarded bool
	var mobileTimezone, navigationTour, marketingConsent, changelog bool
	var startOfWeek int
	err = s.Pool.QueryRow(ctx, `SELECT id::text, user_id::text, theme, is_app_rail_docked,
		is_tour_completed, onboarding_step, use_case, role, is_onboarded, last_workspace_id::text,
		billing_address_country, billing_address, has_billing_address, company_name,
		notification_view_mode, is_smooth_cursor_enabled, is_mobile_onboarded, mobile_onboarding_step,
		mobile_timezone_auto_set, language, start_of_the_week, goals, background_color,
		is_navigation_tour_completed, has_marketing_email_consent, is_subscribed_to_changelog,
		product_tour, created_at, updated_at FROM profiles WHERE user_id::text = $1`, userID).Scan(
		&id, &user, &themeRaw, &appRailDocked, &tourCompleted, &onboardingRaw, &useCase, &role,
		&onboarded, &lastWorkspaceID, &billingCountry, &billingRaw, &hasBilling, &companyName,
		&notificationViewMode, &smoothCursor, &mobileOnboarded, &mobileOnboardingRaw, &mobileTimezone,
		&language, &startOfWeek, &goalsRaw, &backgroundColor, &navigationTour, &marketingConsent,
		&changelog, &productTourRaw, &createdAt, &updatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, fmt.Errorf("read current profile: %w", err)
	}
	return map[string]any{
		"id": id, "user": user, "theme": decodeJSON(themeRaw), "is_app_rail_docked": appRailDocked,
		"is_tour_completed": tourCompleted, "onboarding_step": decodeJSON(onboardingRaw), "use_case": useCase,
		"role": role, "is_onboarded": onboarded, "last_workspace_id": lastWorkspaceID,
		"billing_address_country": billingCountry, "billing_address": decodeJSON(billingRaw),
		"has_billing_address": hasBilling, "company_name": companyName,
		"notification_view_mode": notificationViewMode, "is_smooth_cursor_enabled": smoothCursor,
		"is_mobile_onboarded": mobileOnboarded, "mobile_onboarding_step": decodeJSON(mobileOnboardingRaw),
		"mobile_timezone_auto_set": mobileTimezone, "language": language, "start_of_the_week": startOfWeek,
		"goals": decodeJSON(goalsRaw), "background_color": backgroundColor,
		"is_navigation_tour_completed": navigationTour, "has_marketing_email_consent": marketingConsent,
		"is_subscribed_to_changelog": changelog, "product_tour": decodeJSON(productTourRaw),
		"created_at": createdAt, "updated_at": updatedAt,
	}, nil
}

func (s PostgreSQLStore) SettingsForSession(ctx context.Context, sessionKey string) (map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("user database unavailable")
	}
	userID, err := s.authenticatedUserID(ctx, sessionKey)
	if err != nil {
		return nil, err
	}
	var email string
	if err = s.Pool.QueryRow(ctx, `SELECT COALESCE(email, '') FROM users WHERE id::text = $1`, userID).Scan(&email); err != nil {
		return nil, fmt.Errorf("read settings user: %w", err)
	}
	var lastWorkspaceID *string
	if err = s.Pool.QueryRow(ctx, `SELECT last_workspace_id::text FROM profiles WHERE user_id::text = $1`, userID).Scan(&lastWorkspaceID); err != nil {
		return nil, fmt.Errorf("read profile workspace: %w", err)
	}
	var workspaceID, slug, name, logo *string
	if lastWorkspaceID != nil {
		err = s.Pool.QueryRow(ctx, `SELECT w.id::text, w.slug, w.name,
			CASE WHEN w.logo_asset_id IS NOT NULL THEN '/api/assets/v2/static/' || w.logo_asset_id::text || '/' ELSE COALESCE(w.logo, '') END
			FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
			WHERE w.id::text = $1 AND wm.member_id::text = $2 AND wm.is_active = TRUE
			AND wm.deleted_at IS NULL AND w.deleted_at IS NULL`, *lastWorkspaceID, userID).Scan(&workspaceID, &slug, &name, &logo)
	}
	if lastWorkspaceID == nil || errors.Is(err, pgx.ErrNoRows) {
		lastWorkspaceID = nil
		err = s.Pool.QueryRow(ctx, `SELECT w.id::text, w.slug, w.name,
			CASE WHEN w.logo_asset_id IS NOT NULL THEN '/api/assets/v2/static/' || w.logo_asset_id::text || '/' ELSE COALESCE(w.logo, '') END
			FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
			WHERE wm.member_id::text = $1 AND wm.is_active = TRUE AND wm.deleted_at IS NULL AND w.deleted_at IS NULL
			ORDER BY w.created_at ASC LIMIT 1`, userID).Scan(&workspaceID, &slug, &name, &logo)
		if errors.Is(err, pgx.ErrNoRows) {
			err = nil
		}
	}
	if err != nil {
		return nil, fmt.Errorf("resolve settings workspace: %w", err)
	}
	var invites int
	if err = s.Pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM workspace_member_invites WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`, email).Scan(&invites); err != nil {
		return nil, fmt.Errorf("count workspace invitations: %w", err)
	}
	return map[string]any{"id": userID, "email": email, "workspace": map[string]any{
		"last_workspace_id": lastWorkspaceID, "last_workspace_slug": valueIf(lastWorkspaceID, slug),
		"last_workspace_name": valueIf(lastWorkspaceID, name), "last_workspace_logo": valueIf(lastWorkspaceID, logo),
		"fallback_workspace_id": workspaceID, "fallback_workspace_slug": slug, "invites": invites,
	}}, nil
}

func (s PostgreSQLStore) authenticatedUserID(ctx context.Context, sessionKey string) (string, error) {
	if sessionKey == "" {
		return "", ErrUnauthorized
	}
	var userID string
	err := s.Pool.QueryRow(ctx, `SELECT user_id FROM sessions WHERE session_key = $1 AND expire_date > NOW()`, sessionKey).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) || userID == "" {
		return "", ErrUnauthorized
	}
	return userID, err
}

func decodeJSON(raw []byte) any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	return value
}

func valueIf(condition *string, value *string) any {
	if condition == nil {
		return nil
	}
	return value
}

func (s PostgreSQLStore) CurrentForSession(ctx context.Context, sessionKey string) (map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("user database unavailable")
	}
	if sessionKey == "" {
		return nil, ErrUnauthorized
	}
	var id, username, displayName, email, firstName, lastName, timezone, lastLoginMedium string
	var avatar, coverImage, avatarAssetID, coverAssetID, wallet *string
	var dateJoined, lastLoginTime any
	var isActive, isBot, isEmailVerified, isPasswordAutoset bool
	err := s.Pool.QueryRow(ctx, `SELECT
		u.id::text, u.username, u.display_name, COALESCE(u.email, ''), u.first_name, u.last_name,
		u.avatar, u.cover_image, u.avatar_asset_id::text, u.cover_image_asset_id::text,
		u.date_joined, u.is_active, u.is_bot, u.is_email_verified, u.user_timezone,
		u.is_password_autoset, u.last_login_medium, u.last_login_time, u.metanode_wallet_address
	FROM sessions s JOIN users u ON u.id::text = s.user_id
	WHERE s.session_key = $1 AND s.expire_date > NOW() AND u.is_active = TRUE`, sessionKey).Scan(
		&id, &username, &displayName, &email, &firstName, &lastName, &avatar, &coverImage,
		&avatarAssetID, &coverAssetID, &dateJoined, &isActive, &isBot, &isEmailVerified,
		&timezone, &isPasswordAutoset, &lastLoginMedium, &lastLoginTime, &wallet,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, fmt.Errorf("read current user: %w", err)
	}
	avatarURL := any(avatar)
	if avatarAssetID != nil && *avatarAssetID != "" {
		avatarURL = "/api/assets/v2/static/" + *avatarAssetID + "/"
	}
	coverURL := any(coverImage)
	if coverAssetID != nil && *coverAssetID != "" {
		coverURL = "/api/assets/v2/static/" + *coverAssetID + "/"
	}
	return map[string]any{
		"id": id, "avatar": avatar, "cover_image": coverImage, "avatar_url": avatarURL,
		"cover_image_url": coverURL, "date_joined": dateJoined, "display_name": displayName,
		"email": email, "first_name": firstName, "last_name": lastName, "is_active": isActive,
		"is_bot": isBot, "is_email_verified": isEmailVerified, "user_timezone": timezone,
		"username": username, "is_password_autoset": isPasswordAutoset,
		"last_login_medium": lastLoginMedium, "last_login_time": lastLoginTime,
		"metanode_wallet_address": wallet,
	}, nil
}
