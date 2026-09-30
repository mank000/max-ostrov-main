CREATE TABLE user_profile_avatars (
	user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	media_id bigint NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
	position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, media_id)
);

CREATE INDEX user_profile_avatars_order_idx
ON user_profile_avatars (user_id, position, created_at, media_id);

INSERT INTO user_profile_avatars (user_id, media_id, position)
SELECT id, avatar_media_id, 0
FROM users
WHERE avatar_media_id IS NOT NULL
ON CONFLICT (user_id, media_id) DO NOTHING;
