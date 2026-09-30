-- A reader's 18+ choice never overrides a confirmed moderation block.
CREATE OR REPLACE FUNCTION post_safety_visible(post_key bigint, viewer bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM posts p WHERE p.id=post_key AND p.moderation_hidden_at IS NULL
   AND NOT EXISTS (
    SELECT 1 FROM post_analysis_jobs j WHERE j.post_id=p.id
     AND (j.state='blocked' OR (j.result->>'complete'='true'
      AND COALESCE(j.result->'block_labels','[]'::jsonb)<>'[]'::jsonb))
   )
   AND (NOT reader_requires_safe_content(viewer)
    OR (p.author_user_id=viewer AND NOT p.age_classified)
    OR (EXISTS(SELECT 1 FROM post_analysis_jobs j WHERE j.post_id=p.id
        AND j.state='done' AND j.result->>'complete'='true'
        AND COALESCE(j.result->'review_labels','[]'::jsonb)='[]'::jsonb)
      AND NOT EXISTS(SELECT 1 FROM moderation_reports r WHERE r.target_type='post'
        AND r.target_id=p.id AND r.status='open')))
 );
$$;

-- Staff can revoke either verification level with an auditable reason.
ALTER TABLE support_verification_actions DROP CONSTRAINT support_verification_actions_action_check;
ALTER TABLE support_verification_actions ADD CONSTRAINT support_verification_actions_action_check
 CHECK (action IN ('full', 'age', 'none'));
