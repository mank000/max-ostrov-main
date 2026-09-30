-- A moderator's explicit restore is authoritative over the current AI result.
-- The override lives in the analysis result, so a later edit/recheck replaces it
-- together with the old result instead of carrying it into new content.

-- Repair posts that were already restored before this behavior existed. Only
-- apply the override when the latest moderation action is a restore performed
-- after the currently stored analysis result.
WITH latest_post_action AS (
    SELECT DISTINCT ON (target_id)
        target_id,
        action,
        created_at
    FROM moderation_actions
    WHERE target_type = 'post'
    ORDER BY target_id, id DESC
)
UPDATE post_analysis_jobs job
SET result = jsonb_set(
        COALESCE(job.result, '{}'::jsonb),
        '{moderation_override}',
        to_jsonb('restore'::text),
        true
    ),
    updated_at = now()
FROM latest_post_action action
JOIN posts post ON post.id = action.target_id
WHERE job.post_id = action.target_id
  AND action.action = 'restore'
  AND post.moderation_hidden_at IS NULL
  AND action.created_at >= job.updated_at;

-- Keep the AI result for audit, but let a human restore override its current
-- block/review visibility. post_age_visible still enforces age eligibility, so
-- this does not bypass 18+ restrictions.
CREATE OR REPLACE FUNCTION post_safety_visible(post_key bigint, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM posts p WHERE p.id=post_key AND p.moderation_hidden_at IS NULL
   AND (
    EXISTS(SELECT 1 FROM clips clip WHERE clip.post_id=p.id)
    OR EXISTS(
     SELECT 1 FROM post_analysis_jobs j WHERE j.post_id=p.id
      AND j.result->>'moderation_override'='restore'
    )
    OR NOT EXISTS (
     SELECT 1 FROM post_analysis_jobs j WHERE j.post_id=p.id
      AND (j.state='blocked' OR (j.result->>'complete'='true'
       AND COALESCE(j.result->'block_labels','[]'::jsonb)<>'[]'::jsonb))
    )
   )
   AND (
    EXISTS(
     SELECT 1 FROM post_analysis_jobs j WHERE j.post_id=p.id
      AND j.result->>'moderation_override'='restore'
    )
    OR NOT reader_requires_safe_content(viewer)
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
