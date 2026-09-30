ALTER TABLE posts
DROP CONSTRAINT posts_event_id_fkey;

ALTER TABLE posts
ALTER COLUMN event_id DROP NOT NULL;

ALTER TABLE posts
ADD CONSTRAINT posts_event_id_fkey
FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;

ALTER TABLE posts
ADD COLUMN visibility text NOT NULL DEFAULT 'event'
    CHECK (visibility IN ('public', 'friends', 'event'));

DROP INDEX posts_idempotency_idx;

CREATE UNIQUE INDEX posts_idempotency_idx
ON posts (author_user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX posts_visibility_id_idx
ON posts (visibility, id DESC);
