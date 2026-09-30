ALTER TABLE clip_shares
    ADD COLUMN sender_deleted_at timestamptz,
    ADD COLUMN recipient_deleted_at timestamptz;

CREATE INDEX clip_shares_visible_sender
    ON clip_shares(sender_id, id DESC)
    WHERE sender_deleted_at IS NULL;

CREATE INDEX clip_shares_visible_recipient
    ON clip_shares(recipient_id, id DESC)
    WHERE recipient_deleted_at IS NULL;
