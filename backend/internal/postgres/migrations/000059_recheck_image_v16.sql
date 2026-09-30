-- Re-evaluate visible posts with the new model; never restore hidden material.
INSERT INTO post_analysis_jobs(post_id) SELECT id FROM posts WHERE moderation_hidden_at IS NULL
ON CONFLICT(post_id) DO UPDATE SET revision=post_analysis_jobs.revision+1,state='pending',attempts=0,
run_at=now(),lease_until=NULL,lease_token=NULL,result=NULL,last_error='',updated_at=now();
