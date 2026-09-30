CREATE TABLE support_threads (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider_user_id bigint NOT NULL UNIQUE CHECK (provider_user_id > 0),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE support_messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id bigint NOT NULL REFERENCES support_threads(id),
    sender text NOT NULL CHECK (sender IN ('user', 'staff')),
    sender_provider_id bigint NOT NULL CHECK (sender_provider_id > 0),
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
    platform_message_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (thread_id, platform_message_id)
);

CREATE INDEX support_threads_open_updated ON support_threads (updated_at DESC) WHERE status = 'open';
CREATE INDEX support_messages_thread_created ON support_messages (thread_id, id DESC);
