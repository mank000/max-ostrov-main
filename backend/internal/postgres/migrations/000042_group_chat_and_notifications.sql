ALTER TABLE event_groups
ADD COLUMN IF NOT EXISTS chat_provider text,
ADD COLUMN IF NOT EXISTS chat_url text;

ALTER TABLE event_groups
DROP CONSTRAINT IF EXISTS event_groups_chat_link_check;

ALTER TABLE event_groups
ADD CONSTRAINT event_groups_chat_link_check CHECK (
    (chat_provider IS NULL AND chat_url IS NULL)
    OR (
        chat_provider = 'max'
        AND chat_url IS NOT NULL
        AND char_length(chat_url) BETWEEN 1 AND 500
    )
);

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS group_id bigint REFERENCES event_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notifications_group_idx
ON notifications (group_id)
WHERE group_id IS NOT NULL;
