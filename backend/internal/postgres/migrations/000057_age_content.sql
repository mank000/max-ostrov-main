-- Pending post analysis is adult-only until the server finishes classification.
ALTER TABLE posts ADD COLUMN adult_only boolean NOT NULL DEFAULT true;
ALTER TABLE posts ADD COLUMN age_classified boolean NOT NULL DEFAULT false;
ALTER TABLE post_comments ADD COLUMN adult_only boolean NOT NULL DEFAULT true;
ALTER TABLE post_comments ADD COLUMN age_classified boolean NOT NULL DEFAULT false;
CREATE FUNCTION content_age_visible(restricted boolean, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT restricted OR EXISTS (
  SELECT 1 FROM users WHERE id=viewer AND birth_date IS NOT NULL
  AND birth_date <= (CURRENT_DATE - INTERVAL '18 years')::date
 );
$$;
CREATE FUNCTION post_age_visible(post_key bigint, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT ((p.author_user_id=viewer AND NOT p.age_classified) OR (content_age_visible(p.adult_only,viewer) AND content_age_visible(p.adult_only,p.author_user_id))) AND content_age_visible(COALESCE(source.adult_only,false),viewer) AND content_age_visible(COALESCE(source.adult_only,false),source.author_user_id)
 FROM posts p LEFT JOIN posts source ON source.id=p.repost_of_post_id WHERE p.id=post_key),false);
$$;
-- Classify existing posts without exposing unclassified content to minors.
INSERT INTO post_analysis_jobs(post_id) SELECT id FROM posts WHERE moderation_hidden_at IS NULL
ON CONFLICT(post_id) DO UPDATE SET revision=post_analysis_jobs.revision+1,state='pending',attempts=0,
run_at=now(),lease_until=NULL,lease_token=NULL,result=NULL,last_error='',updated_at=now();
