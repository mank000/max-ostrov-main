ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS post_id bigint REFERENCES posts(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS gift_id bigint REFERENCES user_gifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_post_idx
ON notifications (post_id)
WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_gift_idx
ON notifications (gift_id)
WHERE gift_id IS NOT NULL;
