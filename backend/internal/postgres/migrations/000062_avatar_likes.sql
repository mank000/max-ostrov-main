CREATE TABLE avatar_likes (
  owner_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  avatar_key bigint NOT NULL CHECK (avatar_key >= 0),
  media_id bigint REFERENCES media_assets(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, avatar_key, user_id),
  CHECK (avatar_key = COALESCE(media_id, 0))
);
