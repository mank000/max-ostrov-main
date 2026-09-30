CREATE TABLE realtime_post_watchers (
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX realtime_post_watchers_seen_at_idx ON realtime_post_watchers (seen_at);
