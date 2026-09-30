ALTER TABLE events
ADD CONSTRAINT events_header_artwork_pair_check
CHECK ((header_source_media_id IS NULL) = (header_media_id IS NULL)),
ADD CONSTRAINT events_icon_artwork_pair_check
CHECK ((icon_source_media_id IS NULL) = (icon_media_id IS NULL));
