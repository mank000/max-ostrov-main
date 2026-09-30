-- Extend the existing reader preference to uncertain content. It is not a switch
-- for disabling moderation. Age eligibility remains independent and mandatory.
CREATE FUNCTION reader_requires_safe_content(viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT hide_sensitive_language OR birth_date IS NULL
 OR birth_date > (CURRENT_DATE - INTERVAL '18 years')::date FROM users WHERE id=viewer),true);
$$;

CREATE FUNCTION post_safety_visible(post_key bigint, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT reader_requires_safe_content(viewer) OR EXISTS (
  SELECT 1 FROM posts p WHERE p.id=post_key AND (
   -- Authors retain access to their own draft while its first analysis runs.
   (p.author_user_id=viewer AND NOT p.age_classified)
   OR (EXISTS(SELECT 1 FROM post_analysis_jobs j WHERE j.post_id=p.id
       AND j.state='done' AND j.result->>'complete'='true'
       AND COALESCE(j.result->'review_labels','[]'::jsonb)='[]'::jsonb
       AND COALESCE(j.result->'block_labels','[]'::jsonb)='[]'::jsonb)
     AND NOT EXISTS(SELECT 1 FROM moderation_reports r WHERE r.target_type='post'
       AND r.target_id=p.id AND r.status='open'))
  )
 );
$$;

CREATE OR REPLACE FUNCTION post_age_visible(post_key bigint, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT ((p.author_user_id=viewer AND NOT p.age_classified) OR
 (content_reader_visible(p.adult_only,viewer) AND content_age_visible(p.adult_only,p.author_user_id)))
 AND content_reader_visible(COALESCE(source.adult_only,false),viewer)
 AND content_age_visible(COALESCE(source.adult_only,false),source.author_user_id)
 AND post_safety_visible(p.id,viewer)
 AND (source.id IS NULL OR post_safety_visible(source.id,viewer))
 FROM posts p LEFT JOIN posts source ON source.id=p.repost_of_post_id WHERE p.id=post_key),false);
$$;

CREATE FUNCTION comment_safety_visible(comment_key bigint, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT content_reader_visible(c.adult_only,viewer)
 AND content_age_visible(c.adult_only,c.author_user_id)
 AND (NOT reader_requires_safe_content(viewer) OR (c.age_classified
  AND NOT EXISTS(SELECT 1 FROM moderation_reports r WHERE r.target_type='comment'
     AND r.target_id=c.id AND r.status='open')))
 FROM post_comments c WHERE c.id=comment_key),false);
$$;
