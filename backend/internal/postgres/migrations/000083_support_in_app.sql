-- Store first-party app attachments in the existing MAX support conversation.
ALTER TABLE support_messages
    DROP CONSTRAINT IF EXISTS support_messages_body_check;
ALTER TABLE support_messages
    ADD CONSTRAINT support_messages_body_check CHECK (char_length(body) BETWEEN 0 AND 2000);

CREATE TABLE support_message_media (
    message_id bigint NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
    media_id bigint NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    position smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 3),
    PRIMARY KEY (message_id, media_id),
    UNIQUE (message_id, position)
);

CREATE INDEX support_message_media_media_idx ON support_message_media (media_id);
