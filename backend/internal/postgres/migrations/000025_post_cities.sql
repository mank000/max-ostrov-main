ALTER TABLE posts
ADD COLUMN city text NOT NULL DEFAULT 'Барнаул'
CHECK (char_length(btrim(city)) BETWEEN 1 AND 80);

CREATE INDEX posts_city_feed_idx
ON posts (lower(btrim(city)), id DESC)
WHERE visibility = 'city';
