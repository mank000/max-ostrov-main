package games

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type LeaderboardEntry struct {
	UserID      int64  `json:"user_id"`
	DisplayName string `json:"display_name"`
	PhotoURL    string `json:"photo_url"`
	Value       int64  `json:"value"`
	Detail      int64  `json:"detail"`
}

type LeaderboardResponse struct {
	Leaderboards map[string][]LeaderboardEntry `json:"leaderboards"`
}

func upsertHighScore(ctx context.Context, tx *sql.Tx, userID int64, kind string, value, detail int64, now time.Time) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO game_scores(user_id,kind,value,detail,updated_at)
		VALUES($1,$2,$3,$4,$5)
		ON CONFLICT(user_id,kind) DO UPDATE SET
			value=EXCLUDED.value,
			detail=EXCLUDED.detail,
			updated_at=EXCLUDED.updated_at
		WHERE EXCLUDED.value>game_scores.value
			OR (EXCLUDED.value=game_scores.value AND EXCLUDED.detail>game_scores.detail)
	`, userID, kind, value, detail, now)
	return err
}

func upsertLowScore(ctx context.Context, tx *sql.Tx, userID int64, kind string, value, detail int64, now time.Time) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO game_scores(user_id,kind,value,detail,updated_at)
		VALUES($1,$2,$3,$4,$5)
		ON CONFLICT(user_id,kind) DO UPDATE SET
			value=EXCLUDED.value,
			detail=EXCLUDED.detail,
			updated_at=EXCLUDED.updated_at
		WHERE EXCLUDED.value<game_scores.value
			OR (EXCLUDED.value=game_scores.value AND EXCLUDED.detail<game_scores.detail)
	`, userID, kind, value, detail, now)
	return err
}

func (s *Service) RecordScore(ctx context.Context, userID int64, kind, runID string, value, detail int64) error {
	now := s.now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	switch kind {
	case "memory_easy", "memory_normal", "memory_hard":
		minMoves := map[string]int64{"memory_easy": 6, "memory_normal": 8, "memory_hard": 10}[kind]
		if value < minMoves || value > 10000 || detail < value*120 || detail > int64((24*time.Hour)/time.Millisecond) {
			return ErrInput
		}
		if err = upsertLowScore(ctx, tx, userID, kind, value, detail, now); err != nil {
			return err
		}
	case "flappy":
		if len(runID) != 32 || value < 0 || value > flappyPipeCount || detail != 0 {
			return ErrInput
		}
		var data []byte
		if err = tx.QueryRowContext(ctx, `SELECT state FROM game_runs WHERE id=$1 AND user_id=$2 AND kind='flappy' FOR UPDATE`, runID, userID).Scan(&data); errors.Is(err, sql.ErrNoRows) {
			return ErrMissing
		} else if err != nil {
			return err
		}
		var st flappyState
		if err = json.Unmarshal(data, &st); err != nil {
			return err
		}
		elapsed := now.Sub(st.StartedAt)
		if elapsed < 0 || now.After(st.ExpiresAt.Add(30*time.Second)) || value > int64(elapsed.Seconds()*3)+3 {
			return ErrInput
		}
		if err = upsertHighScore(ctx, tx, userID, kind, value, 0, now); err != nil {
			return err
		}
	case "dino":
		if len(runID) != 32 || value < 0 || detail < 0 {
			return ErrInput
		}
		var data []byte
		if err = tx.QueryRowContext(ctx, `SELECT state FROM game_runs WHERE id=$1 AND user_id=$2 AND kind='dino' FOR UPDATE`, runID, userID).Scan(&data); errors.Is(err, sql.ErrNoRows) {
			return ErrMissing
		} else if err != nil {
			return err
		}
		var st dinoState
		if err = json.Unmarshal(data, &st); err != nil {
			return err
		}
		elapsed := now.Sub(st.StartedAt)
		if elapsed < 0 || now.After(st.ExpiresAt.Add(30*time.Second)) {
			return ErrInput
		}
		maxDistance := int64(elapsed.Seconds()*35) + 100
		if detail > maxDistance || value > detail*250+10000 {
			return ErrInput
		}
		if err = upsertHighScore(ctx, tx, userID, kind, value, detail, now); err != nil {
			return err
		}
	default:
		return ErrInput
	}

	return tx.Commit()
}

func scanLeaderboard(rows *sql.Rows) ([]LeaderboardEntry, error) {
	defer rows.Close()
	items := make([]LeaderboardEntry, 0, 5)
	for rows.Next() {
		var item LeaderboardEntry
		if err := rows.Scan(&item.UserID, &item.DisplayName, &item.PhotoURL, &item.Value, &item.Detail); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) scoreLeaderboard(ctx context.Context, kind string, low bool) ([]LeaderboardEntry, error) {
	order := "score.value DESC, score.detail DESC"
	if low {
		order = "score.value ASC, score.detail ASC"
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT score.user_id, user_account.display_name,
			COALESCE(CASE WHEN user_account.avatar_media_id IS NULL THEN user_account.provider_photo_url
				ELSE '/api/v1/media/' || user_account.avatar_media_id::text || '/content' END, ''),
			score.value, score.detail
		FROM game_scores score
		JOIN users user_account ON user_account.id=score.user_id
		WHERE score.kind=$1
		ORDER BY `+order+`, score.updated_at ASC, score.user_id ASC
		LIMIT 5
	`, kind)
	if err != nil {
		return nil, err
	}
	return scanLeaderboard(rows)
}

func (s *Service) Leaderboards(ctx context.Context) (LeaderboardResponse, error) {
	result := LeaderboardResponse{Leaderboards: map[string][]LeaderboardEntry{}}
	var err error

	for _, kind := range []string{"life", "dino", "flappy", "rhythm", "color", "math"} {
		result.Leaderboards[kind], err = s.scoreLeaderboard(ctx, kind, false)
		if err != nil {
			return LeaderboardResponse{}, err
		}
	}
	for _, kind := range []string{"memory_easy", "memory_normal", "memory_hard"} {
		result.Leaderboards[kind], err = s.scoreLeaderboard(ctx, kind, true)
		if err != nil {
			return LeaderboardResponse{}, err
		}
	}
	return result, nil
}
