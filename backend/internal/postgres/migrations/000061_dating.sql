-- Platform-owned read contract: dating never keeps a second identity snapshot.
CREATE VIEW dating_profile_sources AS
SELECT id AS user_id, COALESCE(NULLIF(display_name, ''), first_name) AS name,
       COALESCE(date_part('year', age(current_date, birth_date))::integer, 0) AS age,
       COALESCE(gender, '') AS gender, city, bio,
       CASE WHEN avatar_media_id IS NULL THEN provider_photo_url
            ELSE '/api/v1/media/' || avatar_media_id::text || '/content' END AS photo
FROM users WHERE moderation_suspended_at IS NULL AND onboarding_version >= 1;

CREATE TABLE dating_profiles (
 user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 settings jsonb NOT NULL,
 adult_confirmed_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dating_swipes (
 from_id bigint NOT NULL REFERENCES dating_profiles(user_id) ON DELETE CASCADE,
 to_id bigint NOT NULL REFERENCES dating_profiles(user_id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('like', 'pass')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (from_id, to_id), CHECK (from_id <> to_id)
);
CREATE TABLE dating_matches (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 a_id bigint NOT NULL REFERENCES dating_profiles(user_id) ON DELETE CASCADE,
 b_id bigint NOT NULL REFERENCES dating_profiles(user_id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(a_id,b_id), CHECK (a_id < b_id)
);
CREATE INDEX dating_matches_b ON dating_matches(b_id);
CREATE TABLE dating_reports (
 from_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 to_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(from_id,to_id), CHECK(from_id <> to_id)
);
CREATE INDEX dating_reports_target ON dating_reports(to_id);

-- Shared block read contract, including blocks created outside dating.
CREATE VIEW dating_pair_blocks AS
 SELECT blocker_id AS from_id, blocked_id AS to_id FROM user_blocks
 UNION ALL SELECT blocked_id, blocker_id FROM user_blocks;
