package rewards

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

func creditGameCoins(ctx context.Context, tx *sql.Tx, userID int64, amountWanted int, description, referenceID, idempotencyKey string, now time.Time) (int, error) {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO
		    coin_wallets (user_id)
		VALUES
		    ($1)
		ON CONFLICT DO NOTHING
	`, userID); err != nil {
		return 0, err
	}
	var balance int64
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    balance
		FROM coin_wallets
		WHERE user_id = $1
		FOR UPDATE
	`, userID).Scan(&balance); err != nil {
		return 0, err
	}
	var previous int
	err := tx.QueryRowContext(ctx, `
		SELECT
		    amount
		FROM coin_transactions
		WHERE user_id = $1
		    AND idempotency_key = $2
	`, userID, idempotencyKey).Scan(&previous)
	if err == nil {
		return previous, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}
	day := gameRewardDay(now)
	var earned int
	if err = tx.QueryRowContext(ctx, `
		SELECT
		    COALESCE(sum(amount), 0)
		FROM coin_transactions
		WHERE user_id = $1
		    AND kind = 'game_reward'
		    AND created_at >= $2
		    AND created_at < $3
	`, userID, day, day.Add(24*time.Hour)).Scan(&earned); err != nil {
		return 0, err
	}
	amount := availableGameCoins(amountWanted, earned)
	if amount == 0 {
		return 0, nil
	}
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
		VALUES
		    ($1, $2, 'game_reward', $3, 'game', $4, $5, $6)
	`, userID, amount, description, referenceID, idempotencyKey, now)
	return amount, err
}

func CreditGameReward(ctx context.Context, tx *sql.Tx, userID int64, runID string, now time.Time) (int, error) {
	return creditGameCoins(ctx, tx, userID, 3, "Победа в мини-игре", runID, "game:"+runID, now)
}

func CreditGameCoin(ctx context.Context, tx *sql.Tx, userID int64, runID string, pipe int, now time.Time) (int, error) {
	referenceID := fmt.Sprintf("%s:%d", runID, pipe)
	return creditGameCoins(ctx, tx, userID, 1, "Монета в мини-игре", referenceID, "game:flappy:"+referenceID, now)
}
