ALTER TABLE posts
DROP CONSTRAINT IF EXISTS posts_visibility_check;

UPDATE posts
SET visibility = 'city'
WHERE visibility = 'public';

ALTER TABLE posts
ALTER COLUMN visibility SET DEFAULT 'city';

ALTER TABLE posts
ADD CONSTRAINT posts_visibility_check
CHECK (visibility IN ('city', 'friends', 'event'));
