ALTER TABLE post_comments
    ADD COLUMN parent_comment_id bigint REFERENCES post_comments(id) ON DELETE CASCADE;

CREATE INDEX post_comments_parent_idx
    ON post_comments (parent_comment_id, id)
    WHERE parent_comment_id IS NOT NULL;
