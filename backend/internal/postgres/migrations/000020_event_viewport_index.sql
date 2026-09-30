CREATE INDEX events_viewport_coordinates_idx
ON events (latitude, longitude, id)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
