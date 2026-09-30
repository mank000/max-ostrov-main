CREATE TABLE users (
    id bigint PRIMARY KEY CHECK (id > 0),
    first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 80),
    last_name text NOT NULL DEFAULT '' CHECK (char_length(last_name) <= 80),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 500),
    city text NOT NULL DEFAULT '' CHECK (char_length(city) <= 80),
    language_code text NOT NULL DEFAULT '' CHECK (char_length(language_code) <= 16),
    photo_url text NOT NULL DEFAULT '' CHECK (char_length(photo_url) <= 2048),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_interests (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    interest text NOT NULL CHECK (char_length(interest) BETWEEN 1 AND 40),
    position smallint NOT NULL CHECK (position >= 0),
    PRIMARY KEY (user_id, interest),
    UNIQUE (user_id, position)
);

CREATE TABLE events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
    organizer_name text NOT NULL CHECK (char_length(organizer_name) BETWEEN 1 AND 120),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
    category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 64),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    venue_name text NOT NULL CHECK (char_length(venue_name) BETWEEN 1 AND 160),
    address text NOT NULL CHECK (char_length(address) BETWEEN 1 AND 240),
    city text NOT NULL CHECK (char_length(city) BETWEEN 1 AND 80),
    latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 160),
    source_url text NOT NULL DEFAULT '' CHECK (char_length(source_url) <= 2048),
    source_updated_at timestamptz NOT NULL,
    ticket_url text NOT NULL DEFAULT '' CHECK (char_length(ticket_url) <= 2048),
    price_min_rubles bigint CHECK (price_min_rubles IS NULL OR price_min_rubles >= 0),
    is_official boolean NOT NULL DEFAULT false,
    is_promoted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR ends_at > starts_at),
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX events_upcoming_idx ON events (starts_at, id)
WHERE ends_at IS NULL;

CREATE INDEX events_ending_idx ON events (ends_at, starts_at, id)
WHERE ends_at IS NOT NULL;
