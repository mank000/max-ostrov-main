ALTER TABLE users
ADD COLUMN show_birth_date boolean NOT NULL DEFAULT true;

CREATE INDEX users_visible_birth_date_idx
ON users (birth_date)
WHERE birth_date IS NOT NULL AND show_birth_date AND moderation_suspended_at IS NULL;

DO $$
DECLARE
  stefan_id bigint;
  qa_id bigint;
BEGIN
  IF (
    SELECT count(*)
    FROM users u
    WHERE lower(trim(u.first_name)) = 'степан'
      AND u.moderation_suspended_at IS NULL
      AND EXISTS (
        SELECT 1 FROM user_identities identity
        WHERE identity.user_id = u.id AND identity.status = 'verified'
      )
  ) = 1 THEN
    SELECT u.id INTO stefan_id
    FROM users u
    WHERE lower(trim(u.first_name)) = 'степан'
      AND u.moderation_suspended_at IS NULL
      AND EXISTS (
        SELECT 1 FROM user_identities identity
        WHERE identity.user_id = u.id AND identity.status = 'verified'
      )
    LIMIT 1;

    INSERT INTO users (
      first_name, display_name, username, city, gender, birth_date,
      onboarding_version, show_birth_date
    )
    VALUES (
      'Алексей', 'Алексей Именинник', 'birthday_qa', 'Барнаул', 'man',
      DATE '2000-09-29', 1, true
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO qa_id;

    IF qa_id IS NULL THEN
      SELECT id INTO qa_id FROM users WHERE lower(username) = 'birthday_qa' LIMIT 1;
    END IF;

    IF qa_id IS NOT NULL THEN
      INSERT INTO user_identities (provider, provider_user_id, user_id, status)
      VALUES ('max', 8999999999999999, qa_id, 'verified')
      ON CONFLICT DO NOTHING;

      IF EXISTS (
        SELECT 1 FROM user_identities identity
        WHERE identity.user_id = qa_id AND identity.status = 'verified'
      ) THEN
        INSERT INTO friendships (user_low_id, user_high_id)
        VALUES (LEAST(stefan_id, qa_id), GREATEST(stefan_id, qa_id))
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;
END $$;
