CREATE TABLE event_participants (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, event_id)
);

CREATE INDEX event_participants_event_idx
ON event_participants (event_id, user_id);

CREATE TABLE saved_events (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, event_id)
);

CREATE INDEX saved_events_event_idx
ON saved_events (event_id, user_id);

CREATE INDEX events_coordinates_idx
ON events (latitude, longitude)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
