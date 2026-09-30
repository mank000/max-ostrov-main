ALTER TABLE posts
ADD COLUMN repost_of_post_id bigint,
ADD COLUMN repost_via_post_id bigint,
ADD COLUMN repost_source_deleted boolean NOT NULL DEFAULT false;

WITH legacy AS (
    SELECT post.id,
        substring(post.caption from '[?&]postId=([0-9]{1,18})([^0-9]|$)') AS source_id_text
    FROM posts post
    WHERE post.caption LIKE '↻ Репост · %'
      AND post.caption ~ '[?&]postId=[0-9]+'
),
resolved AS (
    SELECT legacy.id,
        source_post.id AS source_id,
        COALESCE(source_post.repost_of_post_id, source_post.id) AS root_id
    FROM legacy
    LEFT JOIN posts source_post
      ON legacy.source_id_text IS NOT NULL
     AND source_post.id = legacy.source_id_text::bigint
     AND source_post.id <> legacy.id
)
UPDATE posts target
SET repost_of_post_id = resolved.root_id,
    repost_via_post_id = resolved.source_id,
    repost_source_deleted = resolved.source_id IS NULL,
    caption = ''
FROM resolved
WHERE target.id = resolved.id;

WITH RECURSIVE repost_chain AS (
    SELECT post.id AS repost_id,
        post.repost_of_post_id AS current_id,
        1 AS depth,
        ARRAY[post.id]::bigint[] AS seen
    FROM posts post
    WHERE post.repost_of_post_id IS NOT NULL
    UNION ALL
    SELECT chain.repost_id,
        parent.repost_of_post_id,
        chain.depth + 1,
        chain.seen || parent.id
    FROM repost_chain chain
    JOIN posts parent ON parent.id = chain.current_id
    WHERE parent.repost_of_post_id IS NOT NULL
      AND NOT (parent.id = ANY(chain.seen))
),
roots AS (
    SELECT DISTINCT ON (repost_id) repost_id, current_id
    FROM repost_chain
    ORDER BY repost_id, depth DESC
)
UPDATE posts post
SET repost_of_post_id = roots.current_id
FROM roots
WHERE post.id = roots.repost_id;

UPDATE posts repost
SET visibility = CASE
        WHEN root.visibility = 'friends' THEN 'friends'
        WHEN root.visibility = 'event' THEN 'event'
        ELSE repost.visibility
    END,
    event_id = CASE
        WHEN root.visibility = 'event' THEN root.event_id
        WHEN root.visibility = 'friends' THEN NULL
        ELSE repost.event_id
    END,
    city = CASE
        WHEN root.visibility = 'event' THEN root.city
        ELSE repost.city
    END
FROM posts root
WHERE repost.repost_of_post_id = root.id
  AND root.visibility IN ('friends', 'event');

UPDATE posts
SET repost_of_post_id = NULL,
    repost_via_post_id = NULL,
    repost_source_deleted = true
WHERE repost_of_post_id = id;

ALTER TABLE posts
ADD CONSTRAINT posts_repost_of_post_id_fkey
    FOREIGN KEY (repost_of_post_id) REFERENCES posts(id) ON DELETE SET NULL,
ADD CONSTRAINT posts_repost_via_post_id_fkey
    FOREIGN KEY (repost_via_post_id) REFERENCES posts(id) ON DELETE SET NULL,
ADD CONSTRAINT posts_repost_not_self
    CHECK (repost_of_post_id IS NULL OR repost_of_post_id <> id),
ADD CONSTRAINT posts_repost_via_not_self
    CHECK (repost_via_post_id IS NULL OR repost_via_post_id <> id);

CREATE INDEX posts_repost_of_idx
ON posts (repost_of_post_id)
WHERE repost_of_post_id IS NOT NULL;

CREATE INDEX posts_repost_via_idx
ON posts (repost_via_post_id)
WHERE repost_via_post_id IS NOT NULL;

CREATE OR REPLACE FUNCTION mark_repost_source_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE posts
    SET repost_source_deleted = true,
        repost_of_post_id = NULL
    WHERE repost_of_post_id = OLD.id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER posts_mark_repost_source_deleted
BEFORE DELETE ON posts
FOR EACH ROW
EXECUTE FUNCTION mark_repost_source_deleted();
