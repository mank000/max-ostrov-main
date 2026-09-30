ALTER TABLE game_runs DROP CONSTRAINT IF EXISTS game_runs_kind_check;
ALTER TABLE game_runs ADD CONSTRAINT game_runs_kind_check
CHECK (kind IN ('rhythm','color','math','flappy'));
