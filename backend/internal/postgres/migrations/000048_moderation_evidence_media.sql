

CREATE TABLE moderation_evidence_media (
    report_id bigint NOT NULL REFERENCES moderation_reports(id) ON DELETE CASCADE,
    media_id bigint NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    PRIMARY KEY (report_id, media_id)
);

CREATE INDEX moderation_evidence_media_asset_idx
ON moderation_evidence_media (media_id);

INSERT INTO moderation_evidence_media (report_id, media_id)
SELECT report.id, media.id
FROM moderation_reports report
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(report.target_snapshot -> 'media_ids') = 'array'
        THEN report.target_snapshot -> 'media_ids' ELSE '[]'::jsonb END
) media_ref(id)
JOIN media_assets media ON media.id = media_ref.id::bigint
ON CONFLICT DO NOTHING;
