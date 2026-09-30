CREATE TABLE game_scores (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN (
        'life','dino','flappy','rhythm','color','math',
        'memory_easy','memory_normal','memory_hard'
    )),
    value bigint NOT NULL CHECK (value >= 0),
    detail bigint NOT NULL DEFAULT 0 CHECK (detail >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind)
);

CREATE INDEX game_scores_leaderboard
    ON game_scores(kind, value, detail, updated_at);

INSERT INTO game_scores(user_id, kind, value, detail, updated_at)
SELECT
    user_id,
    'life',
    GREATEST(
        0,
        COALESCE((state->>'cash')::bigint, 0)
        + COALESCE((state->'finance'->>'savings')::bigint, 0)
        + COALESCE((
            SELECT SUM(item.value::bigint)
            FROM jsonb_each_text(COALESCE(state->'finance'->'portfolio', '{}'::jsonb)) item
        ), 0)
        + COALESCE((state->'company'->>'cash')::bigint, 0)
        - COALESCE((state->>'debt')::bigint, 0)
        - COALESCE((state->'company'->>'debt')::bigint, 0)
    ),
    COALESCE((state->>'total_earned')::bigint, 0),
    updated_at
FROM game_life_profiles
ON CONFLICT (user_id, kind) DO NOTHING;

INSERT INTO game_scores(user_id, kind, value, detail, updated_at)
SELECT
    user_id,
    kind,
    MAX((state->>'score')::bigint),
    8,
    MAX(created_at)
FROM game_runs
WHERE kind IN ('rhythm','color','math')
  AND state->>'status'='finished'
GROUP BY user_id, kind
ON CONFLICT (user_id, kind) DO NOTHING;
