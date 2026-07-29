-- users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(128) UNIQUE,
    email VARCHAR(255) UNIQUE,
    password VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    is_bot BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- instances table
CREATE TABLE IF NOT EXISTS instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_name VARCHAR(255) NOT NULL,
    whitelist_emails TEXT,
    instance_id VARCHAR(255) UNIQUE NOT NULL,
    current_version VARCHAR(255) NOT NULL,
    latest_version VARCHAR(255),
    edition VARCHAR(255) DEFAULT 'PLANE_COMMUNITY',
    domain TEXT,
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    namespace VARCHAR(255),
    is_telemetry_enabled BOOLEAN DEFAULT TRUE,
    is_support_required BOOLEAN DEFAULT TRUE,
    is_setup_done BOOLEAN DEFAULT FALSE,
    is_signup_screen_visited BOOLEAN DEFAULT FALSE,
    is_verified BOOLEAN DEFAULT FALSE,
    is_test BOOLEAN DEFAULT FALSE,
    is_current_version_deprecated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- instance_admins table
CREATE TABLE IF NOT EXISTS instance_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    instance_id UUID REFERENCES instances(id) ON DELETE CASCADE,
    role INTEGER DEFAULT 20,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (instance_id, user_id)
);

-- instance_configurations table
CREATE TABLE IF NOT EXISTS instance_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    category TEXT,
    is_encrypted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
