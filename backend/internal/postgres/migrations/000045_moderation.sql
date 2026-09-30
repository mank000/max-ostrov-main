ALTER TABLE users ADD COLUMN moderation_suspended_at timestamptz;
ALTER TABLE posts ADD COLUMN moderation_hidden_at timestamptz;
ALTER TABLE post_comments ADD COLUMN moderation_hidden_at timestamptz;
ALTER TABLE events ADD COLUMN moderation_hidden_at timestamptz;

CREATE TABLE moderation_reports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reporter_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    target_type text NOT NULL CHECK (target_type IN ('user', 'post', 'event', 'comment')),
    target_id bigint NOT NULL CHECK (target_id > 0),
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
    target_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    reviewed_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((reviewed_by_user_id IS NULL) = (reviewed_at IS NULL))
);

CREATE INDEX moderation_reports_queue_idx
ON moderation_reports (status, created_at DESC, id DESC);
CREATE INDEX moderation_reports_target_idx
ON moderation_reports (target_type, target_id, status);

INSERT INTO moderation_reports (
    reporter_user_id, target_type, target_id, reason, target_snapshot, status, created_at
)
SELECT report.reporter_user_id, 'user', report.reported_user_id, report.reason,
    jsonb_build_object('id', target.id, 'display_name', target.display_name,
        'username', target.username,
        'media_ids', CASE WHEN target.avatar_media_id IS NULL THEN '[]'::jsonb
            ELSE jsonb_build_array(target.avatar_media_id) END),
    report.status, report.created_at
FROM user_reports report JOIN users target ON target.id = report.reported_user_id;
DROP TABLE user_reports;

CREATE TABLE moderation_actions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id bigint REFERENCES moderation_reports(id) ON DELETE RESTRICT,
    actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    target_type text NOT NULL CHECK (target_type IN ('user', 'post', 'event', 'comment')),
    target_id bigint NOT NULL CHECK (target_id > 0),
    action text NOT NULL CHECK (action IN ('dismiss', 'hide', 'restore', 'suspend', 'unsuspend')),
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
    previous_state text NOT NULL,
    next_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx
ON moderation_actions (target_type, target_id, id DESC);

CREATE TABLE moderation_login_challenges (
    id text PRIMARY KEY CHECK (char_length(id) BETWEEN 24 AND 80),
    user_id bigint REFERENCES users(id) ON DELETE CASCADE,
    max_user_id bigint NOT NULL CHECK (max_user_id > 0),
    code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_login_challenges_user_idx
ON moderation_login_challenges (user_id, created_at DESC);
CREATE INDEX moderation_login_challenges_expiry_idx
ON moderation_login_challenges (expires_at);

CREATE TABLE moderation_sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX moderation_sessions_user_idx ON moderation_sessions (user_id);
CREATE INDEX moderation_sessions_expiry_idx ON moderation_sessions (expires_at);

CREATE TABLE moderation_role_changes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    subject_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('moderator', 'administrator')),
    operation text NOT NULL CHECK (operation IN ('grant', 'revoke')),
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_role_changes_subject_idx
ON moderation_role_changes (subject_user_id, id DESC);
