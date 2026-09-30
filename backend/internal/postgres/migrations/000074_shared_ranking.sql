-- A small, rotating exploration budget shared by all recommendation surfaces.
-- Eligibility and privacy are applied by each domain before this function is called.
-- The date keeps a page stable during a session while changing the mix on later days.
CREATE FUNCTION ranking_priority(
  relevance numeric, viewer_id bigint, candidate_id bigint,
  surface text, ranking_day date, exploration_budget numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT relevance + CASE
    WHEN sample < 120 THEN exploration_budget * (1 - sample::numeric / 120)
    ELSE exploration_budget * sample::numeric / 6000
  END
  FROM (
    SELECT (('x' || substr(md5(viewer_id::text || ':' || candidate_id::text || ':' || surface || ':' || ranking_day::text), 1, 8))::bit(32)::bigint % 1000) AS sample
  ) rotation;
$$;
