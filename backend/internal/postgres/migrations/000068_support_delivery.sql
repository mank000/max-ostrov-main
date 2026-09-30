ALTER TABLE support_messages
ADD COLUMN delivered_at timestamptz;

UPDATE support_messages
SET delivered_at = created_at
WHERE sender = 'staff';
