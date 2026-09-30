ALTER TABLE events
    DROP CONSTRAINT IF EXISTS events_address_check,
    DROP CONSTRAINT IF EXISTS events_city_check;

ALTER TABLE events
    ADD CONSTRAINT events_address_check CHECK (char_length(address) <= 240),
    ADD CONSTRAINT events_city_check CHECK (char_length(city) <= 80);
