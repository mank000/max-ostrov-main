CREATE TABLE IF NOT EXISTS notification_bot_deliveries (
    notification_id bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider = 'max'),
    provider_user_id bigint NOT NULL CHECK (provider_user_id > 0),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    last_error text NOT NULL DEFAULT '',
    PRIMARY KEY (notification_id, provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS notification_bot_deliveries_pending_idx
ON notification_bot_deliveries (next_attempt_at, notification_id)
WHERE delivered_at IS NULL AND attempts < 5;


INSERT INTO notification_bot_deliveries (
    notification_id, provider, provider_user_id, delivered_at
)
SELECT notification.id, identity.provider, identity.provider_user_id, now()
FROM notifications notification
JOIN user_identities identity ON identity.user_id = notification.user_id
WHERE notification.kind IN (
        'friend_request',
        'friend_request_accepted',
        'gift_received',
        'post_comment',
        'event_reminder'
    )
    AND identity.status = 'verified'
    AND identity.provider = 'max'
ON CONFLICT DO NOTHING;
