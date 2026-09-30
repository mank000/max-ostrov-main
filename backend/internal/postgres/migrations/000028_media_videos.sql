ALTER TABLE media_assets
    DROP CONSTRAINT IF EXISTS media_assets_mime_type_check,
    DROP CONSTRAINT IF EXISTS media_assets_byte_size_check;

ALTER TABLE media_assets
    ADD COLUMN duration_ms integer NOT NULL DEFAULT 0;

ALTER TABLE media_assets
    ADD CONSTRAINT media_assets_mime_type_check
        CHECK (mime_type IN ('image/jpeg', 'image/png', 'video/mp4', 'video/quicktime')),
    ADD CONSTRAINT media_assets_byte_size_check
        CHECK (byte_size BETWEEN 1 AND 104857600),
    ADD CONSTRAINT media_assets_duration_check
        CHECK (
            (mime_type IN ('image/jpeg', 'image/png') AND duration_ms = 0)
            OR
            (mime_type IN ('video/mp4', 'video/quicktime') AND duration_ms BETWEEN 1 AND 300000)
        );
