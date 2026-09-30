ALTER TABLE users
RENAME COLUMN photo_url TO provider_photo_url;

ALTER TABLE users
ADD COLUMN avatar_media_id bigint REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX users_avatar_media_unique_idx
ON users (avatar_media_id)
WHERE avatar_media_id IS NOT NULL;
