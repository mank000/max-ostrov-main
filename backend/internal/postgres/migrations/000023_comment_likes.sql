CREATE TABLE comment_likes (
    comment_id bigint NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX comment_likes_user_idx ON comment_likes (user_id, created_at DESC);
