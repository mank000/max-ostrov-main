ALTER TABLE users
ADD COLUMN username text NOT NULL DEFAULT ''
    CHECK (username = '' OR username ~ '^[a-z0-9_]{3,32}$'),
ADD COLUMN participant_visibility text NOT NULL DEFAULT 'participants'
    CHECK (participant_visibility IN ('participants', 'hidden'));

CREATE UNIQUE INDEX users_username_unique_idx
ON users (lower(username))
WHERE username <> '';

CREATE INDEX users_search_idx
ON users (lower(display_name), lower(username), id);

CREATE TABLE friend_requests (
    requester_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);

CREATE INDEX friend_requests_addressee_idx
ON friend_requests (addressee_id, created_at DESC, requester_id);

CREATE TABLE friendships (
    user_low_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_low_id, user_high_id),
    CHECK (user_low_id < user_high_id)
);

CREATE INDEX friendships_high_user_idx
ON friendships (user_high_id, created_at DESC, user_low_id);

CREATE TABLE user_blocks (
    blocker_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

CREATE INDEX user_blocks_blocked_idx
ON user_blocks (blocked_id, blocker_id);

CREATE TABLE event_invitations (
    event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    sender_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, sender_id, recipient_id),
    CHECK (sender_id <> recipient_id)
);

CREATE INDEX event_invitations_recipient_idx
ON event_invitations (recipient_id, created_at DESC, event_id);
