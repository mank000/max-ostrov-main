ALTER TABLE post_comments
    ADD COLUMN reply_to_user_id bigint REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX post_comments_reply_to_user_idx
    ON post_comments (reply_to_user_id, id)
    WHERE reply_to_user_id IS NOT NULL;

UPDATE post_comments child
SET reply_to_user_id = parent.author_user_id
FROM post_comments parent
WHERE child.parent_comment_id = parent.id;

WITH RECURSIVE lineage AS (
    SELECT id, id AS root_id
    FROM post_comments
    WHERE parent_comment_id IS NULL

    UNION ALL

    SELECT child.id, lineage.root_id
    FROM post_comments child
    JOIN lineage ON child.parent_comment_id = lineage.id
),
ranked_targets AS (
    SELECT reply.id AS comment_id,
           target.author_user_id AS reply_to_user_id,
           target_user.display_name,
           row_number() OVER (
               PARTITION BY reply.id
               ORDER BY char_length(target_user.display_name) DESC, target.id DESC
           ) AS target_rank
    FROM post_comments reply
    JOIN lineage reply_lineage ON reply_lineage.id = reply.id
    JOIN post_comments target
      ON target.post_id = reply.post_id
     AND target.id <> reply.id
    JOIN lineage target_lineage
      ON target_lineage.id = target.id
     AND target_lineage.root_id = reply_lineage.root_id
    JOIN users target_user ON target_user.id = target.author_user_id
    WHERE reply.parent_comment_id IS NOT NULL
      AND left(reply.body, char_length(target_user.display_name) + 2) = target_user.display_name || ', '
)
UPDATE post_comments reply
SET reply_to_user_id = target.reply_to_user_id,
    body = substr(reply.body, char_length(target.display_name) + 3)
FROM ranked_targets target
WHERE reply.id = target.comment_id
  AND target.target_rank = 1;
