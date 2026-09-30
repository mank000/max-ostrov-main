CREATE TABLE event_groups (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    leader_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    capacity smallint NOT NULL CHECK (capacity BETWEEN 2 AND 12),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, event_id)
);

CREATE INDEX event_groups_event_idx
ON event_groups (event_id, created_at, id);

CREATE TABLE group_members (
    group_id bigint NOT NULL,
    event_id bigint NOT NULL,
    user_id bigint NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id),
    UNIQUE (user_id, event_id),
    FOREIGN KEY (group_id, event_id)
        REFERENCES event_groups(id, event_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, event_id)
        REFERENCES event_participants(user_id, event_id) ON DELETE RESTRICT
);

CREATE INDEX group_members_group_idx
ON group_members (group_id, joined_at, user_id);
