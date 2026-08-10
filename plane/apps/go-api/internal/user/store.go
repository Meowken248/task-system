package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgreSQLStore struct {
	Pool *pgxpool.Pool
}

type profileField struct {
	column string
	kind   string
}

var writableProfileFields = map[string]profileField{
	"theme": {"theme", "json"}, "is_app_rail_docked": {"is_app_rail_docked", "bool"},
	"is_tour_completed": {"is_tour_completed", "bool"}, "onboarding_step": {"onboarding_step", "json"},
	"use_case": {"use_case", "nullable_string"}, "role": {"role", "nullable_string"},
	"is_onboarded": {"is_onboarded", "bool"}, "last_workspace_id": {"last_workspace_id", "nullable_uuid"},
	"billing_address_country": {"billing_address_country", "string"}, "billing_address": {"billing_address", "nullable_json"},
	"has_billing_address": {"has_billing_address", "bool"}, "company_name": {"company_name", "string"},
	"notification_view_mode":   {"notification_view_mode", "notification_mode"},
	"is_smooth_cursor_enabled": {"is_smooth_cursor_enabled", "bool"},
	"is_mobile_onboarded":      {"is_mobile_onboarded", "bool"}, "mobile_onboarding_step": {"mobile_onboarding_step", "json"},
	"mobile_timezone_auto_set": {"mobile_timezone_auto_set", "bool"}, "language": {"language", "string"},
	"start_of_the_week": {"start_of_the_week", "weekday"}, "goals": {"goals", "json"},
	"background_color":             {"background_color", "string"},
	"is_navigation_tour_completed": {"is_navigation_tour_completed", "bool"},
	"has_marketing_email_consent":  {"has_marketing_email_consent", "bool"},
	"is_subscribed_to_changelog":   {"is_subscribed_to_changelog", "bool"}, "product_tour": {"product_tour", "json"},
}

var (
	metaNodeAddressPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	URLInNamePattern       = regexp.MustCompile(`(?i)(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|ai|co|dev)(/|\b))`)
)

var writableUserFields = map[string]profileField{
	"display_name":               {"display_name", "short_string"},
	"first_name":                 {"first_name", "name"},
	"last_name":                  {"last_name", "name"},
	"avatar":                     {"avatar", "string"},
	"avatar_asset":               {"avatar_asset_id", "nullable_uuid"},
	"avatar_asset_id":            {"avatar_asset_id", "nullable_uuid"},
	"cover_image":                {"cover_image", "nullable_url"},
	"cover_image_asset":          {"cover_image_asset_id", "nullable_uuid"},
	"cover_image_asset_id":       {"cover_image_asset_id", "nullable_uuid"},
	"is_password_expired":        {"is_password_expired", "bool"},
	"is_password_reset_required": {"is_password_reset_required", "bool"},
	"user_timezone":              {"user_timezone", "timezone"},
	"is_email_valid":             {"is_email_valid", "bool"},
	"masked_at":                  {"masked_at", "nullable_datetime"},
	"metanode_wallet_address":    {"metanode_wallet_address", "wallet"},
}

func (s PostgreSQLStore) UpdateCurrentForSession(ctx context.Context, sessionKey string, payload map[string]any) (map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("user database unavailable")
	}
	userID, err := s.authenticatedUserID(ctx, sessionKey)
	if err != nil {
		return nil, err
	}
	sets := make([]string, 0, len(payload)+1)
	args := make([]any, 0, len(payload)+1)
	errorsByField := ValidationError{}
	for name, raw := range payload {
		field, ok := writableUserFields[name]
		if !ok {
			continue
		}
		value, valid := normalizeUserValue(field.kind, raw)
		if !valid {
			message := "Not a valid value."
			if name == "metanode_wallet_address" {
				message = "MetaNode wallet must be a 20-byte 0x-prefixed address."
			} else if name == "first_name" {
				message = "First name cannot contain a URL."
			} else if name == "last_name" {
				message = "Last name cannot contain a URL."
			}
			errorsByField[name] = []string{message}
			continue
		}
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d", field.column, len(args)))
	}
	if len(errorsByField) != 0 {
		return nil, errorsByField
	}
	if len(sets) != 0 {
		sets = append(sets, "updated_at = NOW()")
		args = append(args, userID)
		query := "UPDATE users SET " + strings.Join(sets, ", ") + fmt.Sprintf(" WHERE id::text = $%d", len(args))
		if _, err = s.Pool.Exec(ctx, query, args...); err != nil {
			return nil, fmt.Errorf("update current user: %w", err)
		}
	}
	return s.CurrentForSession(ctx, sessionKey)
}

func normalizeUserValue(kind string, raw any) (any, bool) {
	switch kind {
	case "short_string":
		value, ok := raw.(string)
		return value, ok && len(value) <= 255
	case "name":
		value, ok := raw.(string)
		return value, ok && len(value) <= 255 && !URLInNamePattern.MatchString(value)
	case "wallet":
		if raw == nil || raw == "" {
			return nil, true
		}
		value, ok := raw.(string)
		return strings.ToLower(value), ok && metaNodeAddressPattern.MatchString(value)
	case "nullable_url":
		if raw == nil || raw == "" {
			return nil, true
		}
		value, ok := raw.(string)
		if !ok || len(value) > 800 {
			return nil, false
		}
		parsed, err := url.ParseRequestURI(value)
		return value, err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
	case "timezone":
		value, ok := raw.(string)
		if !ok || value == "" || len(value) > 255 {
			return nil, false
		}
		_, err := time.LoadLocation(value)
		return value, err == nil
	case "nullable_datetime":
		if raw == nil || raw == "" {
			return nil, true
		}
		value, ok := raw.(string)
		if !ok {
			return nil, false
		}
		_, err := time.Parse(time.RFC3339, value)
		return value, err == nil
	default:
		return normalizeProfileValue(kind, raw)
	}
}

func (s PostgreSQLStore) UpdateProfileForSession(ctx context.Context, sessionKey string, payload map[string]any) (map[string]any, error) {
	if s.Pool == nil {
		return nil, errors.New("user database unavailable")
	}
	userID, err := s.authenticatedUserID(ctx, sessionKey)
	if err != nil {
		return nil, err
	}
	sets := make([]string, 0, len(payload)+1)
	args := make([]any, 0, len(payload)+1)
	errorsByField := ValidationError{}
	for name, raw := range payload {
		field, ok := writableProfileFields[name]
		if !ok {
			continue // DRF ModelSerializer ignores unknown fields on partial updates.
		}
		value, valid := normalizeProfileValue(field.kind, raw)
		if !valid {
			errorsByField[name] = []string{"Not a valid value."}
			continue
		}
		args = append(args, value)
		sets = append(sets, fmt.Sprintf("%s = $%d", field.column, len(args)))
	}
	if len(errorsByField) != 0 {
		return nil, errorsByField
	}
	if len(sets) != 0 {
		sets = append(sets, "updated_at = NOW()")
		args = append(args, userID)
		query := "UPDATE profiles SET " + strings.Join(sets, ", ") + fmt.Sprintf(" WHERE user_id::text = $%d", len(args))
		result, execErr := s.Pool.Exec(ctx, query, args...)
		if execErr != nil {
			return nil, fmt.Errorf("update current profile: %w", execErr)
		}
		if result.RowsAffected() == 0 {
			return nil, ErrUnauthorized
		}
	}
	return s.ProfileForSession(ctx, sessionKey)
}

func normalizeProfileValue(kind string, raw any) (any, bool) {
	switch kind {
	case "bool":
		value, ok := raw.(bool)
		return value, ok
	case "string":
		value, ok := raw.(string)
		return value, ok
	case "nullable_string":
		if raw == nil {
			return nil, true
		}
		value, ok := raw.(string)
		return value, ok
	case "nullable_uuid":
		if raw == nil || raw == "" {
			return nil, true
		}
		value, ok := raw.(string)
		if !ok {
			return nil, false
		}
		_, err := uuid.Parse(value)
		return value, err == nil
	case "weekday":
		value, ok := raw.(float64)
		return int(value), ok && value == float64(int(value)) && value >= 0 && value <= 6
	case "notification_mode":
		value, ok := raw.(string)
		return value, ok && (value == "full" || value == "compact")
	case "json":
		if raw == nil {
			return nil, false
		}
		value, err := json.Marshal(raw)
		return value, err == nil
	case "nullable_json":
		if raw == nil {
			return nil, true
		}
		value, err := json.Marshal(raw)
		return value, err == nil
	default:
		return nil, false
	}
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
