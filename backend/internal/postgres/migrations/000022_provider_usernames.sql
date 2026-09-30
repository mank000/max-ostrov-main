ALTER TABLE user_identities
ADD COLUMN provider_username text;

ALTER TABLE user_identities
ADD CONSTRAINT user_identities_provider_username_format
CHECK (provider_username IS NULL OR provider_username ~ '^[a-z0-9_]{3,64}$');
