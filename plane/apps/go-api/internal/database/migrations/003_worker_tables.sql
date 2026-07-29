CREATE TABLE IF NOT EXISTS email_notification_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    receiver_id uuid NOT NULL,
    triggered_by_id uuid,
    entity_identifier uuid,
    entity_name character varying(255) NOT NULL,
    data jsonb,
    processed_at timestamp with time zone,
    sent_at timestamp with time zone,
    entity character varying(200) NOT NULL,
    old_value character varying(300),
    new_value character varying(300)
);

CREATE TABLE IF NOT EXISTS webhook_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    workspace_id uuid NOT NULL,
    webhook uuid NOT NULL,
    event_type character varying(255),
    request_method character varying(10),
    request_headers text,
    request_body text,
    response_status text,
    response_headers text,
    response_body text,
    retry_count smallint NOT NULL DEFAULT 0
);
