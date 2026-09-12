BEGIN;
INSERT INTO profiles (
	id, created_at, updated_at, theme, is_tour_completed, onboarding_step, use_case, role, is_onboarded,
	last_workspace_id, billing_address_country, billing_address, has_billing_address, company_name,
	user_id, is_mobile_onboarded, mobile_onboarding_step, mobile_timezone_auto_set, language,
	is_smooth_cursor_enabled, start_of_the_week, is_app_rail_docked, background_color, goals,
	has_marketing_email_consent, is_navigation_tour_completed, is_subscribed_to_changelog,
	notification_view_mode, product_tour
) VALUES (
	gen_random_uuid(), NOW(), NOW(), '{}'::jsonb, FALSE,
	'{"profile_complete":false,"workspace_create":false,"workspace_invite":false,"workspace_join":false}'::jsonb,
	NULL, NULL, FALSE, NULL, 'INDIA', NULL, FALSE, '',
	'57687b17-025b-4147-96f5-3b2b653c9c32', FALSE,
	'{"profile_complete":false,"workspace_create":false,"workspace_join":false}'::jsonb,
	FALSE, 'en', FALSE, 0, TRUE, '#3b82f6', '{}'::jsonb, FALSE, FALSE, FALSE, 'full',
	'{"work_items":false,"cycles":false,"modules":false,"intake":false,"pages":false}'::jsonb
);
INSERT INTO user_notification_preferences (
	id, created_at, updated_at, property_change, state_change, comment, mention, issue_completed,
	created_by_id, project_id, updated_by_id, user_id, workspace_id, deleted_at
) VALUES (
	gen_random_uuid(), NOW(), NOW(), TRUE, TRUE, TRUE, TRUE, TRUE,
	NULL, NULL, NULL, '57687b17-025b-4147-96f5-3b2b653c9c32', NULL, NULL
);
COMMIT;
