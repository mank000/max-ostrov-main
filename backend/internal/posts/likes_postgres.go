package posts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"kutezh/backend/internal/notifications"
)

func (r *PostgresRepository) SetLike(ctx context.Context, userID, postID int64, liked bool) (*int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin post like: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var authorID int64
	var caption string
	err = tx.QueryRowContext(ctx, `
		SELECT post.author_user_id, left(btrim(post.caption), 80)
		FROM posts post
		WHERE post.id = $2
			AND `+postVisibleToViewerSQL+`
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = post.author_user_id)
					OR (block.blocker_id = post.author_user_id AND block.blocked_id = $1)
			)
		FOR SHARE OF post`, userID, postID).Scan(&authorID, &caption)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("authorize post like: %w", err)
	}

	var recipientID *int64
	if liked {
		var created bool
		if err := tx.QueryRowContext(ctx, `
			WITH inserted AS (
				INSERT INTO post_likes (post_id, user_id)
				VALUES ($1, $2)
				ON CONFLICT DO NOTHING
				RETURNING 1
			)
			SELECT EXISTS (SELECT 1 FROM inserted)`, postID, userID).Scan(&created); err != nil {
			return nil, fmt.Errorf("like post: %w", err)
		}
		if created && authorID != userID {
			dedupeKey := fmt.Sprintf("post_like:%d:%d", postID, userID)
			body := "Понравилась ваша публикация."
			if caption != "" {
				body = "Понравилась публикация «" + caption + "»."
			}
			var notificationID int64
			err := tx.QueryRowContext(ctx, `
				INSERT INTO notifications (
					user_id, kind, title, body, post_id, actor_user_id, dedupe_key
				)
				VALUES (
					$1, 'post_like', 'Новая отметка «Нравится»',
					$2, $3, $4, $5
				)
				ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING id`,
				authorID, body, postID, userID, dedupeKey,
			).Scan(&notificationID)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return nil, fmt.Errorf("create post like notification: %w", err)
			}
			if err == nil {
				if err := notifications.EnqueueBotDelivery(ctx, tx, notificationID); err != nil {
					return nil, err
				}
			}
			recipient := authorID
			recipientID = &recipient
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM post_likes
			WHERE post_id = $1 AND user_id = $2`, postID, userID); err != nil {
			return nil, fmt.Errorf("unlike post: %w", err)
		}
		if authorID != userID {
			if _, err := tx.ExecContext(ctx, `
				UPDATE notifications
				SET read_at = COALESCE(read_at, now())
				WHERE user_id = $1
					AND kind = 'post_like'
					AND post_id = $2
					AND actor_user_id = $3
					AND read_at IS NULL`,
				authorID, postID, userID,
			); err != nil {
				return nil, fmt.Errorf("retire post like notification: %w", err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit post like: %w", err)
	}
	return recipientID, nil
}

func (r *PostgresRepository) ListLikes(ctx context.Context, userID, postID int64, limit int) ([]User, error) {
	var authorized bool
	if err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM posts post
			WHERE post.id = $2
				AND `+postVisibleToViewerSQL+`
				AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = post.author_user_id)
					OR (block.blocker_id = post.author_user_id AND block.blocked_id = $1)
			)
		)`, userID, postID).Scan(&authorized); err != nil {
		return nil, fmt.Errorf("authorize post likes: %w", err)
	}
	if !authorized {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT jsonb_build_object('id', liker.id, 'username', liker.username,
			'display_name', liker.display_name, 'photo_url', CASE WHEN liker.avatar_media_id IS NULL THEN liker.provider_photo_url ELSE '/api/v1/media/' || liker.avatar_media_id::text || '/content' END,
			'equipped_decoration_code', liker.equipped_decoration_code)
		FROM post_likes likes
		JOIN users liker ON liker.id = likes.user_id
		WHERE likes.post_id = $2 AND liker.moderation_suspended_at IS NULL AND NOT EXISTS (
			SELECT 1 FROM user_blocks block
			WHERE (block.blocker_id = $1 AND block.blocked_id = liker.id)
				OR (block.blocker_id = liker.id AND block.blocked_id = $1)
		)
		ORDER BY likes.created_at DESC, likes.user_id DESC
		LIMIT $3`, userID, postID, limit)
	if err != nil {
		return nil, fmt.Errorf("list post likes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]User, 0, limit)
	for rows.Next() {
		var item User
		var userJSON []byte
		if err := rows.Scan(&userJSON); err != nil {
			return nil, fmt.Errorf("scan post liker: %w", err)
		}
		if err := json.Unmarshal(userJSON, &item); err != nil {
			return nil, fmt.Errorf("decode post liker: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
