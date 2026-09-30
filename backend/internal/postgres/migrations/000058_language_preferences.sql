-- Reading preference never changes the author's age eligibility.
ALTER TABLE users ADD COLUMN hide_sensitive_language boolean NOT NULL DEFAULT true;
CREATE FUNCTION content_reader_visible(restricted boolean, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT content_age_visible(restricted,viewer) AND (NOT restricted OR EXISTS (
  SELECT 1 FROM users WHERE id=viewer AND NOT hide_sensitive_language
 ));
$$;
CREATE OR REPLACE FUNCTION post_age_visible(post_key bigint, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT ((p.author_user_id=viewer AND NOT p.age_classified) OR
 (content_reader_visible(p.adult_only,viewer) AND content_age_visible(p.adult_only,p.author_user_id)))
 AND content_reader_visible(COALESCE(source.adult_only,false),viewer)
 AND content_age_visible(COALESCE(source.adult_only,false),source.author_user_id)
 FROM posts p LEFT JOIN posts source ON source.id=p.repost_of_post_id WHERE p.id=post_key),false);
$$;
-- Reclassify visible posts for expanded language labels without restoring hidden content.
UPDATE posts SET adult_only=true,age_classified=false WHERE moderation_hidden_at IS NULL;
INSERT INTO post_analysis_jobs(post_id) SELECT id FROM posts WHERE moderation_hidden_at IS NULL
ON CONFLICT(post_id) DO UPDATE SET revision=post_analysis_jobs.revision+1,state='pending',attempts=0,
run_at=now(),lease_until=NULL,lease_token=NULL,result=NULL,last_error='',updated_at=now();
