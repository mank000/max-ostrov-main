ALTER TABLE coin_transactions DROP CONSTRAINT coin_transactions_kind_check;
ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_kind_check CHECK (kind IN (
'attendance_reward','achievement_reward','store_purchase','gift_purchase','adjustment','game_reward'));
CREATE TABLE game_runs (
 id text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('rhythm','color','math')),
 state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_key)
);
CREATE INDEX game_runs_user_created ON game_runs(user_id,created_at DESC);
