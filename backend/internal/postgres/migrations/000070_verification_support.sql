-- Extend the existing MAX support conversation without replacing its production history.
ALTER TABLE users ADD COLUMN face_avatar_verified_media_id bigint;

ALTER TABLE support_threads ADD COLUMN assigned_staff_provider_id bigint;
ALTER TABLE support_messages ADD COLUMN photo_token text
    CHECK (photo_token IS NULL OR char_length(photo_token) BETWEEN 1 AND 2048);

CREATE TABLE support_bot_deliveries (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id bigint NOT NULL REFERENCES support_threads(id),
    message_id bigint NOT NULL REFERENCES support_messages(id),
    recipient_provider_id bigint NOT NULL CHECK (recipient_provider_id > 0),
    kind text NOT NULL CHECK (kind IN ('request', 'user_message')),
    attempts integer NOT NULL DEFAULT 0,
    claimed_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (message_id, recipient_provider_id)
);
CREATE INDEX support_bot_deliveries_pending ON support_bot_deliveries(id)
    WHERE sent_at IS NULL;

CREATE TABLE support_verification_actions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    thread_id bigint NOT NULL REFERENCES support_threads(id),
    subject_user_id bigint NOT NULL REFERENCES users(id),
    actor_user_id bigint NOT NULL REFERENCES users(id),
    action text NOT NULL CHECK (action IN ('full', 'age')),
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
    created_at timestamptz NOT NULL DEFAULT now()
);
