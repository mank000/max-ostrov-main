-- Repair posts that a moderator already restored after the old worker converted
-- an image-only 18+ signal into a profanity_underage block. Keep the repair
-- intentionally narrow: the current AI result must carry the human restore
-- override, the only block label must be profanity_underage, text must not have
-- strong profanity/obscenity signals, and an image must be the 18+ source.
WITH visual_only_restores AS (
    SELECT post.id
    FROM posts post
    JOIN post_analysis_jobs job ON job.post_id = post.id
    WHERE post.moderation_hidden_at IS NULL
      AND post.adult_only
      AND job.result->>'moderation_override' = 'restore'
      AND jsonb_array_length(COALESCE(job.result->'block_labels','[]'::jsonb)) = 1
      AND COALESCE(job.result->'block_labels','[]'::jsonb) @> '["profanity_underage"]'::jsonb
      AND COALESCE((job.result #>> '{text,scores,profanity}')::double precision, 0) < 0.9
      AND COALESCE((job.result #>> '{text,scores,obscenity}')::double precision, 0) < 0.9
      AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(job.result #> '{text,flags}','[]'::jsonb)) AS flags(value)
          WHERE flags.value IN ('profanity','obscenity','obscene')
      )
      AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(job.result #> '{text,review_flags}','[]'::jsonb)) AS flags(value)
          WHERE flags.value IN ('profanity','obscenity','obscene')
      )
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(job.result->'images','[]'::jsonb)) AS images(item)
          WHERE COALESCE((images.item #>> '{analysis,scores,sexual_suggestive}')::double precision, 0) >= 0.8
      )
)
UPDATE posts post
SET adult_only = false,
    age_classified = true
FROM visual_only_restores restored
WHERE post.id = restored.id;
