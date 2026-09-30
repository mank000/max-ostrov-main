-- Explicit negative feedback is private to the viewer and never changes post visibility for others.
CREATE TABLE feed_feedback (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    hidden_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX feed_feedback_post_idx ON feed_feedback(post_id);

-- Bound lookups for recent authored conversation and incoming dating intent.
CREATE INDEX post_comments_author_recent_idx ON post_comments(author_user_id, created_at DESC);
CREATE INDEX dating_swipes_recipient_kind_idx ON dating_swipes(to_id, kind, created_at DESC);
