-- Clips are temporarily excluded from AI moderation.
-- Human moderation, reports, local deterministic text rules and 18+ language
-- classification remain active.

-- Restore clips hidden only by the former AI post-analysis decision. A latest
-- explicit human hide remains authoritative.
WITH ai_hidden AS (
    SELECT post.id
    FROM posts post
    JOIN clips clip ON clip.post_id = post.id
    JOIN post_analysis_jobs job ON job.post_id = post.id
    WHERE post.moderation_hidden_at IS NOT NULL
      AND (
        job.state = 'blocked'
        OR (
          job.result->>'complete' = 'true'
          AND COALESCE(job.result->'block_labels','[]'::jsonb) <> '[]'::jsonb
        )
      )
      AND COALESCE((
        SELECT action
        FROM moderation_actions action
        WHERE action.target_type = 'post' AND action.target_id = post.id
        ORDER BY action.id DESC
        LIMIT 1
      ), '') <> 'hide'
)
UPDATE posts post
SET moderation_hidden_at = NULL
FROM ai_hidden
WHERE post.id = ai_hidden.id;

-- Old AI reports for clips no longer affect visibility or moderator queues.
UPDATE moderation_reports report
SET status = 'dismissed',
    version = version + 1
WHERE report.target_type = 'post'
  AND report.source = 'ai'
  AND report.status = 'open'
  AND EXISTS (SELECT 1 FROM clips clip WHERE clip.post_id = report.target_id);

-- Safe Content must not require an AI-completed job for a clip. Open human/user
-- reports still hide a clip from strict readers, and explicit moderation_hidden_at
-- still hides it from everyone.
CREATE OR REPLACE FUNCTION post_safety_visible(post_key bigint, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM posts p WHERE p.id=post_key AND p.moderation_hidden_at IS NULL
   AND (
    EXISTS(SELECT 1 FROM clips clip WHERE clip.post_id=p.id)
    OR NOT EXISTS (
     SELECT 1 FROM post_analysis_jobs j WHERE j.post_id=p.id
      AND (j.state='blocked' OR (j.result->>'complete'='true'
       AND COALESCE(j.result->'block_labels','[]'::jsonb)<>'[]'::jsonb))
    )
   )
   AND (
    NOT reader_requires_safe_content(viewer)
    OR (
     EXISTS(SELECT 1 FROM clips clip WHERE clip.post_id=p.id)
     AND NOT EXISTS(SELECT 1 FROM moderation_reports r WHERE r.target_type='post'
       AND r.target_id=p.id AND r.status='open')
    )
    OR (p.author_user_id=viewer AND NOT p.age_classified)
    OR (
     EXISTS(SELECT 1 FROM post_analysis_jobs j WHERE j.post_id=p.id
       AND j.state='done' AND j.result->>'complete'='true'
       AND COALESCE(j.result->'review_labels','[]'::jsonb)='[]'::jsonb)
     AND NOT EXISTS(SELECT 1 FROM moderation_reports r WHERE r.target_type='post'
       AND r.target_id=p.id AND r.status='open')
    )
   )
 );
$$;
