ALTER TABLE event_groups
ADD COLUMN join_policy text NOT NULL DEFAULT 'open'
CHECK (join_policy IN ('open', 'request', 'invite_only'));

CREATE TABLE group_join_requests (
    group_id bigint NOT NULL REFERENCES event_groups(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE TABLE group_invitations (
    group_id bigint NOT NULL REFERENCES event_groups(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX group_invitations_user_idx
ON group_invitations (user_id, created_at, group_id);

CREATE TABLE group_merge_requests (
    source_group_id bigint PRIMARY KEY REFERENCES event_groups(id) ON DELETE CASCADE,
    target_group_id bigint NOT NULL REFERENCES event_groups(id) ON DELETE CASCADE,
    requested_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (source_group_id <> target_group_id)
);

CREATE INDEX group_merge_requests_target_idx
ON group_merge_requests (target_group_id, created_at, source_group_id);
