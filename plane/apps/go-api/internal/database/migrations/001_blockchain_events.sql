CREATE TABLE IF NOT EXISTS go_blockchain_events (
    id BIGSERIAL PRIMARY KEY,
    workspace_slug TEXT NOT NULL,
    project_id UUID NOT NULL,
    issue_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    transaction_hash TEXT,
    client_event_id TEXT,
    on_chain BOOLEAN NOT NULL DEFAULT TRUE,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    persistence_status TEXT NOT NULL DEFAULT 'committed',
    payload JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT go_blockchain_events_type_check
        CHECK (event_type IN ('create_task', 'assign_task', 'daily_report', 'delete_task', 'task_content'))
);

CREATE UNIQUE INDEX IF NOT EXISTS go_blockchain_events_transaction_hash_unique
    ON go_blockchain_events (LOWER(transaction_hash))
    WHERE transaction_hash IS NOT NULL AND transaction_hash <> '';

CREATE UNIQUE INDEX IF NOT EXISTS go_blockchain_events_client_event_unique
    ON go_blockchain_events (workspace_slug, project_id, client_event_id)
    WHERE client_event_id IS NOT NULL AND client_event_id <> '';

CREATE INDEX IF NOT EXISTS go_blockchain_events_project_recorded
    ON go_blockchain_events (workspace_slug, project_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS go_blockchain_events_issue
    ON go_blockchain_events (issue_id, recorded_at DESC);
