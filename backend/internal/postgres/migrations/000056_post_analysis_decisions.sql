ALTER TABLE post_analysis_jobs DROP CONSTRAINT post_analysis_jobs_state_check;
ALTER TABLE post_analysis_jobs ADD CONSTRAINT post_analysis_jobs_state_check
 CHECK (state IN ('pending','processing','done','review','failed','blocked'));
CREATE TABLE post_analysis_decisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 post_id bigint REFERENCES posts(id) ON DELETE SET NULL,
 revision bigint NOT NULL,
 reason text NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(post_id,revision)
);
