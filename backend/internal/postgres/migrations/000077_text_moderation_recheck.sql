-- Re-evaluate visible posts after restoring V19 high-confidence text actions
-- and semantic caption analysis for Clips. Pending content remains fail-closed
-- for minors and Safe Mode until the durable worker completes the new revision.
UPDATE posts
SET adult_only = true,
    age_classified = false
WHERE moderation_hidden_at IS NULL;

INSERT INTO post_analysis_jobs(post_id)
SELECT id
FROM posts
WHERE moderation_hidden_at IS NULL
ON CONFLICT(post_id) DO UPDATE SET
    revision = post_analysis_jobs.revision + 1,
    state = 'pending',
    attempts = 0,
    run_at = now(),
    lease_until = NULL,
    lease_token = NULL,
    result = NULL,
    last_error = '',
    updated_at = now();
