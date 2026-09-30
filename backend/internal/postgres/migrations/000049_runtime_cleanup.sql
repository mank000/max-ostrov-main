CREATE INDEX media_assets_expiry_idx ON media_assets (created_at, id);
CREATE INDEX profile_avatars_media_idx ON user_profile_avatars (media_id);
CREATE INDEX profile_avatars_crop_idx ON user_profile_avatars (crop_media_id) WHERE crop_media_id IS NOT NULL;
CREATE INDEX events_header_source_idx ON events (header_source_media_id) WHERE header_source_media_id IS NOT NULL;
CREATE INDEX events_header_media_idx ON events (header_media_id) WHERE header_media_id IS NOT NULL;
CREATE INDEX events_icon_source_idx ON events (icon_source_media_id) WHERE icon_source_media_id IS NOT NULL;
CREATE INDEX events_icon_media_idx ON events (icon_media_id) WHERE icon_media_id IS NOT NULL;
CREATE INDEX background_jobs_finished_idx ON background_jobs (finished_at, id) WHERE finished_at IS NOT NULL;
CREATE INDEX bot_deliveries_finished_idx ON notification_bot_deliveries (delivered_at, notification_id) WHERE delivered_at IS NOT NULL;

CREATE TABLE media_file_cleanup (
    storage_key text PRIMARY KEY,
    queued_at timestamptz NOT NULL DEFAULT now(),
    run_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX media_file_cleanup_ready_idx ON media_file_cleanup (run_at);

CREATE FUNCTION queue_media_file_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO media_file_cleanup (storage_key) VALUES (OLD.storage_key) ON CONFLICT DO NOTHING;
    RETURN OLD;
END;
$$;
CREATE TRIGGER media_file_cleanup_after_delete AFTER DELETE ON media_assets
FOR EACH ROW EXECUTE FUNCTION queue_media_file_cleanup();
