CREATE TABLE media_assets (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key text NOT NULL UNIQUE CHECK (char_length(storage_key) BETWEEN 1 AND 160),
    mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png')),
    byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
    width integer NOT NULL CHECK (width BETWEEN 1 AND 12000),
    height integer NOT NULL CHECK (height BETWEEN 1 AND 12000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_assets_owner_idx
ON media_assets (owner_user_id, created_at DESC, id DESC);

CREATE TABLE posts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    author_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 2000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX posts_event_idx ON posts (event_id, id DESC);
CREATE INDEX posts_author_idx ON posts (author_user_id, id DESC);

CREATE TABLE post_media (
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_id bigint NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE RESTRICT,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 9),
    PRIMARY KEY (post_id, position)
);

CREATE TABLE post_participant_tags (
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX post_participant_tags_user_idx
ON post_participant_tags (user_id, post_id DESC);

CREATE TABLE attendance_confirmations (
    event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
    location_matched boolean NOT NULL DEFAULT false,
    evidence_submitted_at timestamptz NOT NULL,
    reviewed_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    PRIMARY KEY (event_id, user_id),
    CHECK ((reviewed_by_user_id IS NULL) = (reviewed_at IS NULL))
);

CREATE INDEX attendance_confirmations_status_idx
ON attendance_confirmations (event_id, status, evidence_submitted_at);

CREATE TABLE attendance_media (
    event_id bigint NOT NULL,
    user_id bigint NOT NULL,
    media_id bigint NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE RESTRICT,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
    PRIMARY KEY (event_id, user_id, position),
    FOREIGN KEY (event_id, user_id)
        REFERENCES attendance_confirmations(event_id, user_id) ON DELETE CASCADE
);

CREATE TABLE notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    event_id bigint REFERENCES events(id) ON DELETE CASCADE,
    actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, dedupe_key)
);

CREATE INDEX notifications_user_idx
ON notifications (user_id, read_at, id DESC);

CREATE TABLE background_jobs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('notification')),
    payload jsonb NOT NULL,
    dedupe_key text NOT NULL UNIQUE CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
    run_at timestamptz NOT NULL DEFAULT now(),
    attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
    locked_at timestamptz,
    finished_at timestamptz,
    last_error text NOT NULL DEFAULT '' CHECK (char_length(last_error) <= 1000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX background_jobs_ready_idx
ON background_jobs (run_at, id)
WHERE finished_at IS NULL;
