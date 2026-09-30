package rewards

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"time"
)

func (r *PostgresRepository) SendGift(ctx context.Context, senderID, recipientID int64, input GiftInput, now time.Time) (Gift, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Gift{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var existing Gift
	err = tx.QueryRowContext(ctx, `SELECT gift.id,gift.sender_user_id,gift.recipient_user_id,
		gift.item_code,item.title,gift.message,gift.created_at
		FROM user_gifts gift JOIN store_items item ON item.code=gift.item_code
		WHERE gift.sender_user_id=$1 AND gift.idempotency_key=$2`, senderID, input.IdempotencyKey).
		Scan(&existing.ID, &existing.SenderID, &existing.RecipientID, &existing.ItemCode,
			&existing.Title, &existing.Message, &existing.CreatedAt)
	if err == nil {
		if existing.RecipientID != recipientID || existing.ItemCode != input.ItemCode || existing.Message != input.Message {
			return Gift{}, ErrIdempotencyConflict
		}
		return existing, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Gift{}, fmt.Errorf("read previous gift: %w", err)
	}
	var friends, blocked bool
	err = tx.QueryRowContext(ctx, `
		SELECT
			EXISTS (
				SELECT 1 FROM friendships
				WHERE user_low_id = LEAST($1::bigint, $2::bigint)
					AND user_high_id = GREATEST($1::bigint, $2::bigint)
			),
			EXISTS (
				SELECT 1 FROM user_blocks
				WHERE (blocker_id = $1::bigint AND blocked_id = $2::bigint)
					OR (blocker_id = $2::bigint AND blocked_id = $1::bigint)
			)
	`, senderID, recipientID).Scan(&friends, &blocked)
	if err != nil {
		return Gift{}, fmt.Errorf("check gift recipient: %w", err)
	}
	if !friends || blocked {
		return Gift{}, ErrNotFriends
	}
	var title string
	var price int64
	err = tx.QueryRowContext(ctx, `
		SELECT title, coin_price
		FROM store_items
		WHERE code = $1 AND kind = 'gift' AND active
		FOR SHARE
	`, input.ItemCode).Scan(&title, &price)
	if errors.Is(err, sql.ErrNoRows) {
		return Gift{}, ErrNotFound
	}
	if err != nil {
		return Gift{}, err
	}
	var gift Gift
	err = tx.QueryRowContext(ctx, `
		INSERT INTO user_gifts (
			sender_user_id, recipient_user_id, item_code, message, idempotency_key, created_at
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (sender_user_id, idempotency_key) DO NOTHING
		RETURNING id, sender_user_id, recipient_user_id, item_code, message, created_at
	`, senderID, recipientID, input.ItemCode, input.Message, input.IdempotencyKey, now).
		Scan(&gift.ID, &gift.SenderID, &gift.RecipientID, &gift.ItemCode, &gift.Message, &gift.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRowContext(ctx, `
			SELECT id, sender_user_id, recipient_user_id, item_code, message, created_at
			FROM user_gifts
			WHERE sender_user_id = $1 AND idempotency_key = $2
		`, senderID, input.IdempotencyKey).
			Scan(&gift.ID, &gift.SenderID, &gift.RecipientID, &gift.ItemCode, &gift.Message, &gift.CreatedAt)
		if err != nil {
			return Gift{}, err
		}
		if gift.RecipientID != recipientID || gift.ItemCode != input.ItemCode || gift.Message != input.Message {
			return Gift{}, ErrIdempotencyConflict
		}
		gift.Title = title
		return gift, tx.Commit()
	}
	if err != nil {
		return Gift{}, err
	}
	gift.Title = title
	_, err = tx.ExecContext(ctx, `
		INSERT INTO coin_transactions (
			user_id, amount, kind, description, reference_type, reference_id, idempotency_key, created_at
		) VALUES ($1, $2, 'gift_purchase', $3, 'gift', $4, $5, $6)
	`, senderID, -price, "Подарок: "+title, strconv.FormatInt(gift.ID, 10), "gift:"+input.IdempotencyKey, now)
	if err != nil {
		return Gift{}, mapBalanceError(err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO background_jobs (kind, payload, dedupe_key, run_at)
		VALUES (
			'notification',
			jsonb_build_object(
				'user_id', $1::bigint,
				'kind', 'gift_received',
				'title', 'Новый подарок',
				'body', 'Вам подарили «' || $2 || '».',
				'gift_id', $4::bigint,
				'actor_user_id', $3::bigint,
				'dedupe_key', 'gift:' || $4::bigint::text
			),
			'gift:' || $4::bigint::text,
			$5
		)
		ON CONFLICT (dedupe_key) DO NOTHING
	`, recipientID, title, senderID, gift.ID, now)
	if err != nil {
		return Gift{}, err
	}
	if err := tx.Commit(); err != nil {
		return Gift{}, err
	}
	return gift, nil
}

func (r *PostgresRepository) Gifts(ctx context.Context, userID, beforeID int64, limit int) ([]Gift, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT gift.id,gift.sender_user_id,gift.recipient_user_id,gift.item_code,item.title,gift.message,gift.created_at,
			sender.id,sender.username,sender.display_name,
			CASE WHEN sender.avatar_media_id IS NULL THEN sender.provider_photo_url ELSE '/api/v1/media/' || sender.avatar_media_id::text || '/content' END
		FROM user_gifts gift
		JOIN store_items item ON item.code=gift.item_code
		JOIN users sender ON sender.id=gift.sender_user_id
		WHERE gift.recipient_user_id=$1 AND($2=0 OR gift.id<$2)
		ORDER BY gift.id DESC
		LIMIT $3`, userID, beforeID, limit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := []Gift{}
	for rows.Next() {
		var item Gift
		var sender GiftSender
		if err := rows.Scan(
			&item.ID, &item.SenderID, &item.RecipientID, &item.ItemCode, &item.Title, &item.Message, &item.CreatedAt,
			&sender.ID, &sender.Username, &sender.DisplayName, &sender.PhotoURL,
		); err != nil {
			return nil, err
		}
		item.Sender = &sender
		items = append(items, item)
	}
	return items, rows.Err()
}
