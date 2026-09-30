ALTER TABLE users
ADD COLUMN onboarding_version integer NOT NULL DEFAULT 0
    CHECK (onboarding_version >= 0);
