ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS idempotency_key text,
    ADD COLUMN IF NOT EXISTS idempotency_hash bytea;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_idempotency_pair_check') THEN
        ALTER TABLE posts ADD CONSTRAINT posts_idempotency_pair_check CHECK (
            (idempotency_key IS NULL) = (idempotency_hash IS NULL)
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_idempotency_key_length_check') THEN
        ALTER TABLE posts ADD CONSTRAINT posts_idempotency_key_length_check CHECK (
            idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128
        );
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS posts_idempotency_idx
ON posts (author_user_id, event_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_reports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reporter_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (reporter_user_id <> reported_user_id)
);

CREATE INDEX IF NOT EXISTS user_reports_status_idx
ON user_reports (status, created_at DESC, id DESC);
