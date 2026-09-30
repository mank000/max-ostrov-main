-- A committed post and its analysis request are written in the same transaction.
CREATE TABLE post_analysis_jobs (
    post_id bigint PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 1,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','done','review','failed')),
    attempts integer NOT NULL DEFAULT 0,
    run_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    lease_token text,
    result jsonb,
    last_error text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_analysis_jobs_ready ON post_analysis_jobs(run_at,post_id)
    WHERE state IN ('pending','processing');
CREATE TABLE post_analysis_media_cache (
    media_id bigint NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    model_version text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(media_id,model_version)
);
ALTER TABLE moderation_reports ADD COLUMN source text NOT NULL DEFAULT 'user'
    CHECK (source IN ('user','ai'));
CREATE UNIQUE INDEX moderation_reports_ai_open ON moderation_reports(target_type,target_id)
    WHERE source='ai' AND status='open';
