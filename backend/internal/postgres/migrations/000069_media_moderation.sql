ALTER TABLE media_assets
ADD COLUMN moderated_safe boolean NOT NULL DEFAULT false;

UPDATE media_assets media
SET moderated_safe = true
WHERE EXISTS (SELECT 1 FROM comment_media WHERE media_id = media.id)
   OR EXISTS (SELECT 1 FROM users WHERE avatar_media_id = media.id)
   OR EXISTS (
       SELECT 1 FROM user_profile_avatars
       WHERE media_id = media.id OR crop_media_id = media.id
   )
   OR EXISTS (
       SELECT 1 FROM events
       WHERE media.id IN (header_source_media_id, header_media_id, icon_source_media_id, icon_media_id)
   )
   OR EXISTS (SELECT 1 FROM attendance_media WHERE media_id = media.id);
