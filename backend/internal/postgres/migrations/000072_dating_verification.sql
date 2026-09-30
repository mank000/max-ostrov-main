-- Dating reads the current platform verification state; no second identity snapshot.
CREATE OR REPLACE VIEW dating_profile_sources AS
SELECT id AS user_id, COALESCE(NULLIF(display_name, ''), first_name) AS name,
       COALESCE(date_part('year', age(current_date, birth_date))::integer, 0) AS age,
       COALESCE(gender, '') AS gender, city, bio,
       CASE WHEN avatar_media_id IS NULL THEN provider_photo_url
            ELSE '/api/v1/media/' || avatar_media_id::text || '/content' END AS photo,
       COALESCE((SELECT jsonb_agg('/api/v1/media/' || a.media_id::text || '/content' ORDER BY a.position,a.created_at,a.media_id)
                 FROM user_profile_avatars a WHERE a.user_id=users.id), '[]'::jsonb) AS photos,
       CASE WHEN face_verified_at IS NULL THEN 'none'
            WHEN face_avatar_verified_media_id = avatar_media_id OR EXISTS (
                SELECT 1 FROM user_profile_avatars a WHERE a.user_id=users.id
                AND face_avatar_verified_media_id IN (a.media_id,a.crop_media_id)) THEN 'full'
            ELSE 'age' END AS verification_tier
FROM users WHERE moderation_suspended_at IS NULL AND onboarding_version >= 1;
