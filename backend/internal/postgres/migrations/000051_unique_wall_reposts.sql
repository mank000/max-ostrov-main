-- Keep duplicate content and its comments recoverable; only the first repost
-- remains visible. Record which rows were hidden by this migration.
CREATE TABLE repost_deduplication_log (
    post_id bigint PRIMARY KEY,
    kept_post_id bigint NOT NULL,
    deduplicated_at timestamptz NOT NULL DEFAULT now()
);

WITH ranked AS (
    SELECT id, first_value(id) OVER (
        PARTITION BY author_user_id, repost_of_post_id ORDER BY id
    ) AS kept_id
    FROM posts
    WHERE repost_of_post_id IS NOT NULL AND moderation_hidden_at IS NULL
)
INSERT INTO repost_deduplication_log (post_id, kept_post_id)
SELECT id, kept_id FROM ranked WHERE id <> kept_id;

UPDATE posts SET moderation_hidden_at = now()
WHERE id IN (SELECT post_id FROM repost_deduplication_log);

CREATE UNIQUE INDEX posts_one_active_repost_per_author
ON posts (author_user_id, repost_of_post_id)
WHERE repost_of_post_id IS NOT NULL AND moderation_hidden_at IS NULL;
