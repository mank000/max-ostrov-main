ALTER TABLE coin_transactions DROP CONSTRAINT IF EXISTS coin_transactions_kind_check;
ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_kind_check CHECK (kind IN (
    'attendance_reward',
    'achievement_reward',
    'store_purchase',
    'gift_purchase',
    'adjustment',
    'game_reward',
    'referral_reward'
));

CREATE TABLE referrals (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    referrer_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (referrer_user_id <> referred_user_id)
);

CREATE INDEX referrals_referrer_idx
ON referrals (referrer_user_id, id DESC);
