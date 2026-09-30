package rewards

import (
	"context"
	"fmt"
	"time"
)

// Один набор метрик для выдачи наград и для показанного прогресса.
// Повторное чтение после выдачи сохраняем: параллельные действия могли изменить счётчики.
const achievementProgressSQL = `		    progress AS (
		        SELECT
		            'confirmed_attendance' metric,
		            count(*)::int value
		        FROM attendance_confirmations
		        WHERE user_id = $1
		            AND status = 'confirmed'
		        UNION ALL
		        SELECT
		            'posts',
		            count(*)::int
		        FROM posts
		        WHERE author_user_id = $1
		        UNION ALL
		        SELECT
		            'friends',
		            count(*)::int
		        FROM friendships
		        WHERE user_low_id = $1
		            OR user_high_id = $1
		        UNION ALL
		        SELECT
		            'groups',
		            count(*)::int
		        FROM group_members
		        WHERE user_id = $1
		    )`

func (r *PostgresRepository) Achievements(ctx context.Context, userID int64, now time.Time) ([]Achievement, []string, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("begin achievement evaluation: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()
	rows, err := tx.QueryContext(ctx, `
		WITH
`+achievementProgressSQL+`,
		    unlocked AS (
		        INSERT INTO
		            user_achievements (user_id, achievement_code, unlocked_at)
		        SELECT
		            $1,
		            definition.code,
		            $2
		        FROM achievement_definitions definition
		            JOIN progress ON progress.metric = definition.metric
		        WHERE progress.value >= definition.target
		        ON CONFLICT DO NOTHING
		        RETURNING achievement_code
		    )
		SELECT
		    achievement_code
		FROM unlocked
	`, userID, now)
	if err != nil {
		return nil, nil, fmt.Errorf("unlock achievements: %w", err)
	}
	var unlocked []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			_ = rows.Close()
			return nil, nil, err
		}
		unlocked = append(unlocked, code)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, nil, err
	}
	for _, code := range unlocked {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO
			    coin_transactions (
			        user_id,
			        amount,
			        kind,
			        description,
			        reference_type,
			        reference_id,
			        idempotency_key,
			        created_at
			    )
			SELECT
			    $1,
			    reward_coins,
			    'achievement_reward',
			    'Награда за достижение «' || title || '»',
			    'achievement',
			    code,
			    'achievement:' || code,
			    $3
			FROM achievement_definitions
			WHERE code = $2
			    AND reward_coins > 0
			ON CONFLICT (user_id, idempotency_key) DO NOTHING
		`, userID, code, now)
		if err != nil {
			return nil, nil, fmt.Errorf("reward achievement: %w", err)
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO
			    background_jobs (kind, payload, dedupe_key, run_at)
			SELECT
			    'notification',
			    jsonb_build_object(
			        'user_id',
			        $1::bigint,
			        'kind',
			        'achievement_unlocked',
			        'title',
			        'Новое достижение',
			        'body',
			        'Открыто достижение «' || title || '».',
			        'dedupe_key',
			        'achievement:' || $1::bigint::text || ':' || code
			    ),
			    'achievement:' || $1::bigint::text || ':' || code,
			    $3
			FROM achievement_definitions
			WHERE code = $2
			ON CONFLICT (dedupe_key) DO NOTHING
		`, userID, code, now)
		if err != nil {
			return nil, nil, fmt.Errorf("enqueue achievement notification: %w", err)
		}
	}
	rows, err = tx.QueryContext(ctx, `
		WITH
`+achievementProgressSQL+`
		SELECT
		    definition.code,
		    definition.title,
		    definition.description,
		    CASE
		        WHEN achieved.unlocked_at IS NOT NULL THEN definition.target
		        ELSE LEAST(progress.value, definition.target)
		    END,
		    definition.target,
		    definition.reward_coins,
		    achieved.unlocked_at
		FROM achievement_definitions definition
		    JOIN progress ON progress.metric = definition.metric
		    LEFT JOIN user_achievements achieved ON achieved.user_id = $1
		    AND achieved.achievement_code = definition.code
		ORDER BY
		    achieved.unlocked_at DESC NULLS LAST,
		    definition.code
	`, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("list achievements: %w", err)
	}
	items := []Achievement{}
	for rows.Next() {
		var item Achievement
		if err := rows.Scan(&item.Code, &item.Title, &item.Description, &item.Progress, &item.Target, &item.RewardCoins, &item.UnlockedAt); err != nil {
			_ = rows.Close()
			return nil, nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, fmt.Errorf("commit achievement evaluation: %w", err)
	}
	return items, unlocked, nil
}
