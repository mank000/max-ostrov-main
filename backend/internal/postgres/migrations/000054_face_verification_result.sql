ALTER TABLE users
ADD COLUMN face_last_estimated_age integer,
ADD COLUMN face_last_profile_age integer,
ADD COLUMN face_last_age_delta integer,
ADD COLUMN face_last_score double precision,
ADD COLUMN face_last_checked_at timestamptz;

UPDATE users
SET
    face_verified_at = NULL,
    face_last_estimated_age = NULL,
    face_last_profile_age = NULL,
    face_last_age_delta = NULL,
    face_last_score = NULL,
    face_last_checked_at = NULL,
    updated_at = now()
WHERE id IN (
    SELECT identity.user_id
    FROM user_identities identity
    WHERE identity.provider = 'max'
      AND identity.provider_user_id = 4052056
      AND identity.status = 'verified'
);
