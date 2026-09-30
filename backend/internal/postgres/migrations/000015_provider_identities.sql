CREATE SEQUENCE users_internal_id_seq AS bigint;

SELECT setval(
    'users_internal_id_seq',
    GREATEST(COALESCE((SELECT max(id) FROM users), 0) + 1, 1),
    false
);

ALTER SEQUENCE users_internal_id_seq OWNED BY users.id;
ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('users_internal_id_seq');

CREATE TABLE user_identities (
    provider text NOT NULL CHECK (provider = 'max'),
    provider_user_id bigint NOT NULL CHECK (provider_user_id > 0),
    user_id bigint NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'verified' CHECK (status = 'verified'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_user_id)
);


INSERT INTO user_identities (provider, provider_user_id, user_id)
SELECT 'max', id, id
FROM users;
