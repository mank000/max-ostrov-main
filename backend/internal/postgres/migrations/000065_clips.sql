ALTER TABLE media_assets ADD COLUMN clip_ready boolean NOT NULL DEFAULT false;
-- Clips reuse posts, their moderation, reactions, media permissions and lifecycle.
CREATE TABLE clips (
 post_id bigint PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
 cover_ms integer NOT NULL DEFAULT 0 CHECK(cover_ms BETWEEN 0 AND 180000)
);
CREATE TABLE user_follows (
 follower_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 followed_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(follower_id,followed_id), CHECK(follower_id<>followed_id)
);
CREATE INDEX user_follows_followed ON user_follows(followed_id,follower_id);
CREATE TABLE clip_feedback (
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 post_id bigint NOT NULL REFERENCES clips(post_id) ON DELETE CASCADE,
 watched_ms integer NOT NULL DEFAULT 0 CHECK(watched_ms BETWEEN 0 AND 180000),
 hidden boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,post_id)
);
CREATE TABLE clip_shares (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 post_id bigint NOT NULL REFERENCES clips(post_id) ON DELETE CASCADE,
 sender_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(post_id,sender_id,recipient_id), CHECK(sender_id<>recipient_id)
);
CREATE INDEX clip_shares_inbox ON clip_shares(recipient_id,id DESC);
CREATE TABLE clip_feed_sessions (
 id text PRIMARY KEY,
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope text NOT NULL,
 author_id bigint NOT NULL DEFAULT 0,
 post_ids bigint[] NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE INDEX clip_feed_expiry ON clip_feed_sessions(expires_at);
