CREATE TABLE auth_sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    user_id bigint NOT NULL CHECK (user_id > 0),
    first_name text NOT NULL CHECK (char_length(first_name) <= 80),
    last_name text NOT NULL DEFAULT '' CHECK (char_length(last_name) <= 80),
    language_code text NOT NULL DEFAULT '' CHECK (char_length(language_code) <= 16),
    photo_url text NOT NULL DEFAULT '' CHECK (char_length(photo_url) <= 2048),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);
