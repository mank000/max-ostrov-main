CREATE TABLE group_removed_members (
    group_id bigint NOT NULL REFERENCES event_groups(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    removed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);
