CREATE TABLE post_likes (
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX post_likes_user_idx ON post_likes (user_id, created_at DESC);

CREATE TABLE post_comments (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX post_comments_post_idx ON post_comments (post_id, id);

CREATE TABLE coin_wallets (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coin_transactions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount bigint NOT NULL CHECK (amount <> 0),
    kind text NOT NULL CHECK (kind IN (
        'attendance_reward', 'achievement_reward', 'store_purchase', 'gift_purchase', 'adjustment'
    )),
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 240),
    reference_type text NOT NULL DEFAULT '' CHECK (char_length(reference_type) <= 40),
    reference_id text NOT NULL DEFAULT '' CHECK (char_length(reference_id) <= 120),
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);

CREATE INDEX coin_transactions_user_idx ON coin_transactions (user_id, id DESC);

CREATE FUNCTION apply_coin_transaction() RETURNS trigger AS $$
BEGIN
    INSERT INTO coin_wallets (user_id) VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE coin_wallets
    SET balance = balance + NEW.amount, updated_at = NEW.created_at
    WHERE user_id = NEW.user_id AND balance + NEW.amount >= 0;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient coin balance' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coin_transaction_updates_wallet
AFTER INSERT ON coin_transactions
FOR EACH ROW EXECUTE FUNCTION apply_coin_transaction();

CREATE TABLE achievement_definitions (
    code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{3,40}$'),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 240),
    metric text NOT NULL CHECK (metric IN ('confirmed_attendance', 'posts', 'friends', 'groups')),
    target integer NOT NULL CHECK (target > 0),
    reward_coins bigint NOT NULL DEFAULT 0 CHECK (reward_coins >= 0)
);

INSERT INTO achievement_definitions (code, title, description, metric, target, reward_coins) VALUES
    ('first_meeting', 'Первая встреча', 'Подтвердите посещение первого мероприятия.', 'confirmed_attendance', 1, 20),
    ('event_regular', 'Постоянный участник', 'Подтвердите посещение пяти мероприятий.', 'confirmed_attendance', 5, 50),
    ('first_post', 'Первое впечатление', 'Опубликуйте первую запись о мероприятии.', 'posts', 1, 10),
    ('social_circle', 'Новые связи', 'Добавьте пять друзей.', 'friends', 5, 30),
    ('group_companion', 'Идём вместе', 'Вступите хотя бы в одну группу.', 'groups', 1, 15);

CREATE TABLE user_achievements (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_code text NOT NULL REFERENCES achievement_definitions(code) ON DELETE RESTRICT,
    unlocked_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_code)
);

CREATE INDEX user_achievements_unlocked_idx
ON user_achievements (user_id, unlocked_at DESC);

CREATE TABLE organizer_profiles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
    reviewed_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_user_id, name),
    CHECK ((reviewed_by_user_id IS NULL) = (reviewed_at IS NULL))
);

CREATE INDEX organizer_profiles_status_idx
ON organizer_profiles (status, created_at, id);

CREATE TABLE user_roles (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('moderator', 'administrator')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role)
);

ALTER TABLE events
ADD COLUMN organizer_profile_id bigint REFERENCES organizer_profiles(id) ON DELETE SET NULL;

CREATE INDEX events_organizer_profile_idx
ON events (organizer_profile_id, starts_at DESC, id DESC)
WHERE organizer_profile_id IS NOT NULL;

CREATE TABLE store_items (
    code text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{3,40}$'),
    kind text NOT NULL CHECK (kind IN ('profile_decoration', 'profile_boost', 'event_boost', 'gift')),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 240),
    coin_price bigint NOT NULL CHECK (coin_price > 0),
    duration_hours integer CHECK (duration_hours IS NULL OR duration_hours BETWEEN 1 AND 720),
    active boolean NOT NULL DEFAULT true,
    CHECK ((kind IN ('profile_boost', 'event_boost')) = (duration_hours IS NOT NULL))
);

INSERT INTO store_items (code, kind, title, description, coin_price, duration_hours) VALUES
    ('city_lights', 'profile_decoration', 'Огни города', 'Оформление профиля для любителей городских событий.', 120, NULL),
    ('profile_spotlight', 'profile_boost', 'Профиль в центре внимания', 'Небольшой бонус в списке участников на 24 часа.', 200, 24),
    ('event_spotlight', 'event_boost', 'Поднять мероприятие', 'Небольшой бонус в рекомендациях на 24 часа.', 300, 24),
    ('gift_star', 'gift', 'Звезда встречи', 'Небольшой знак внимания после совместного события.', 50, NULL),
    ('gift_coffee', 'gift', 'Кофе после события', 'Тёплый знак внимания новому знакомому.', 80, NULL);

ALTER TABLE users
ADD COLUMN equipped_decoration_code text REFERENCES store_items(code) ON DELETE SET NULL;

CREATE TABLE store_purchases (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_code text NOT NULL REFERENCES store_items(code) ON DELETE RESTRICT,
    target_event_id bigint REFERENCES events(id) ON DELETE CASCADE,
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 120),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);

CREATE TABLE user_inventory (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_code text NOT NULL REFERENCES store_items(code) ON DELETE RESTRICT,
    purchased_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, item_code)
);

CREATE TABLE profile_boosts (
    user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    CHECK (ends_at > starts_at)
);

CREATE TABLE event_boosts (
    event_id bigint PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    purchased_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    CHECK (ends_at > starts_at)
);

CREATE INDEX event_boosts_active_idx ON event_boosts (ends_at, event_id);

CREATE TABLE user_gifts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sender_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_code text NOT NULL REFERENCES store_items(code) ON DELETE RESTRICT,
    message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 240),
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 120),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (sender_user_id, idempotency_key),
    CHECK (sender_user_id <> recipient_user_id)
);

CREATE INDEX user_gifts_recipient_idx
ON user_gifts (recipient_user_id, id DESC);
