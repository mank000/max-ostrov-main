ALTER TABLE events
ADD COLUMN header_source_media_id bigint REFERENCES media_assets(id) ON DELETE RESTRICT,
ADD COLUMN header_media_id bigint REFERENCES media_assets(id) ON DELETE RESTRICT,
ADD COLUMN icon_source_media_id bigint REFERENCES media_assets(id) ON DELETE RESTRICT,
ADD COLUMN icon_media_id bigint REFERENCES media_assets(id) ON DELETE RESTRICT;
