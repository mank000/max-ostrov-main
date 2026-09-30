ALTER TABLE users
ADD COLUMN last_seen_at timestamptz;

CREATE INDEX users_last_seen_at_idx
ON users (last_seen_at DESC)
WHERE last_seen_at IS NOT NULL;
