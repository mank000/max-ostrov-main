package users

import (
	"context"
	"database/sql"
	"errors"
)

func creditReferral(ctx context.Context, tx *sql.Tx, referrerID, referredID int64) error {
	var referralID int64
	err := tx.QueryRowContext(ctx, `
		INSERT INTO referrals (referrer_user_id, referred_user_id)
		SELECT $1, $2
		WHERE $1 <> $2 AND EXISTS (SELECT 1 FROM users WHERE id = $1)
		ON CONFLICT (referred_user_id) DO NOTHING
		RETURNING id`, referrerID, referredID,
	).Scan(&referralID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO coin_transactions (
			user_id, amount, kind, description, reference_type, reference_id, idempotency_key
		) VALUES
			($1, 150, 'referral_reward', 'Бонус за приглашённого друга', 'referral', $2::text, 'referral:invite:' || $2::text),
			($2, 50, 'referral_reward', 'Бонус за приглашение в Кутёж', 'referral', $1::text, 'referral:welcome:' || $1::text)
		ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
		referrerID, referredID,
	)
	return err
}
