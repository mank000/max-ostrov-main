ALTER TABLE user_profile_avatars
ADD COLUMN crop_media_id bigint REFERENCES media_assets(id) ON DELETE SET NULL;

UPDATE user_profile_avatars
SET crop_media_id = media_id
WHERE crop_media_id IS NULL;

CREATE UNIQUE INDEX user_profile_avatars_crop_owner_unique
ON user_profile_avatars (user_id, crop_media_id)
WHERE crop_media_id IS NOT NULL;
