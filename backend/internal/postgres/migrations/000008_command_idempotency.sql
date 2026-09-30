ALTER TABLE events
ADD COLUMN IF NOT EXISTS idempotency_key text,
ADD COLUMN IF NOT EXISTS idempotency_hash bytea;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_idempotency_pair_check') THEN
        ALTER TABLE events ADD CONSTRAINT events_idempotency_pair_check CHECK (
            (idempotency_key IS NULL) = (idempotency_hash IS NULL)
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_idempotency_key_length_check') THEN
        ALTER TABLE events ADD CONSTRAINT events_idempotency_key_length_check CHECK (
            idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128
        );
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS events_idempotency_idx
ON events (created_by_user_id, idempotency_key)
WHERE created_by_user_id IS NOT NULL AND idempotency_key IS NOT NULL;

ALTER TABLE event_groups
ADD COLUMN IF NOT EXISTS created_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
ADD COLUMN IF NOT EXISTS idempotency_key text,
ADD COLUMN IF NOT EXISTS idempotency_hash bytea;

UPDATE event_groups
SET created_by_user_id = leader_user_id;

ALTER TABLE event_groups
ALTER COLUMN created_by_user_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_groups_idempotency_pair_check') THEN
        ALTER TABLE event_groups ADD CONSTRAINT event_groups_idempotency_pair_check CHECK (
            (idempotency_key IS NULL) = (idempotency_hash IS NULL)
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_groups_idempotency_key_length_check') THEN
        ALTER TABLE event_groups ADD CONSTRAINT event_groups_idempotency_key_length_check CHECK (
            idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 1 AND 128
        );
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS event_groups_idempotency_idx
ON event_groups (created_by_user_id, event_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
