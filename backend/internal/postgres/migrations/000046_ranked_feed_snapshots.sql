

CREATE TABLE ranked_feed_snapshots (
    id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{32}$'),
    viewer_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > created_at)
);
CREATE INDEX ranked_feed_snapshots_expiry_idx ON ranked_feed_snapshots(expires_at);
CREATE INDEX ranked_feed_snapshots_viewer_idx ON ranked_feed_snapshots(viewer_user_id, created_at DESC);

CREATE TABLE ranked_feed_items (
    snapshot_id text NOT NULL REFERENCES ranked_feed_snapshots(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    PRIMARY KEY (snapshot_id, position),
    UNIQUE (snapshot_id, post_id)
);
CREATE INDEX ranked_feed_items_post_idx ON ranked_feed_items(post_id);
