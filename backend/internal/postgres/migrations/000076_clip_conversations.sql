ALTER TABLE clip_shares
    ADD COLUMN read_at timestamptz,
    ADD COLUMN reply_emoji text CHECK (reply_emoji IS NULL OR char_length(reply_emoji) BETWEEN 1 AND 12),
    ADD COLUMN replied_at timestamptz,
    ADD COLUMN reply_read_at timestamptz;

-- Existing deliveries had no read state; do not turn the entire history unread.
UPDATE clip_shares SET read_at = created_at;

CREATE INDEX clip_shares_sender_unread ON clip_shares(sender_id, replied_at DESC)
    WHERE reply_emoji IS NOT NULL AND reply_read_at IS NULL;
