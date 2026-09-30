package notifications

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) List(ctx context.Context, userID int64, unreadOnly bool, beforeID int64, limit int) ([]Notification, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT notification.id, notification.kind, notification.title, notification.body,
			notification.event_id, notification.post_id, notification.gift_id, notification.group_id, notification.actor_user_id,
			COALESCE(actor.display_name, ''),
			COALESCE(actor.username, ''),
			COALESCE(
				CASE
					WHEN actor.id IS NULL THEN ''
					WHEN actor.avatar_media_id IS NULL THEN actor.provider_photo_url
					ELSE '/api/v1/media/' || actor.avatar_media_id::text || '/content'
				END,
				''
			),
			EXISTS (SELECT 1 FROM clips clip WHERE clip.post_id = notification.post_id),
			notification.read_at, notification.created_at
		FROM notifications notification
		LEFT JOIN users actor ON actor.id = notification.actor_user_id
		WHERE notification.user_id = $1 AND (NOT $2 OR notification.read_at IS NULL)
   AND ($4 = 0 OR notification.id < $4)
			AND `+notificationModerationVisibilitySQL+`
			AND `+notificationUnblockedSQL+`
		ORDER BY notification.id DESC LIMIT $3`, userID, unreadOnly, limit, beforeID)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]Notification, 0, limit)
	for rows.Next() {
		var item Notification
		if err := rows.Scan(
			&item.ID, &item.Kind, &item.Title, &item.Body,
			&item.EventID, &item.PostID, &item.GiftID, &item.GroupID, &item.ActorUserID,
			&item.ActorDisplayName, &item.ActorUsername, &item.ActorPhotoURL,
			&item.IsClip, &item.ReadAt, &item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notifications: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) MarkRead(ctx context.Context, userID, notificationID int64, now time.Time) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE notifications SET read_at = COALESCE(read_at, $3)
		WHERE id = $2 AND user_id = $1`, userID, notificationID, now)
	if err != nil {
		return fmt.Errorf("mark notification read: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read notification update: %w", err)
	}
	if updated == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) MarkAllRead(ctx context.Context, userID int64, now time.Time) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE notifications SET read_at = $2
		WHERE user_id = $1 AND read_at IS NULL`, userID, now)
	if err != nil {
		return fmt.Errorf("mark all notifications read: %w", err)
	}
	return nil
}

func (r *PostgresRepository) MarkMatchesRead(ctx context.Context, userID int64, now time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE notifications SET read_at=$2 WHERE user_id=$1 AND kind='dating_match' AND read_at IS NULL`, userID, now)
	return err
}

const notificationUnblockedSQL = `NOT EXISTS (
	SELECT 1 FROM user_blocks block
	WHERE (block.blocker_id = $1 AND block.blocked_id = notification.actor_user_id)
		OR (block.blocker_id = notification.actor_user_id AND block.blocked_id = $1)
)`

func (r *PostgresRepository) Counts(ctx context.Context, userID int64) (Counts, error) {
	var counts Counts
	err := r.db.QueryRowContext(ctx, `
		SELECT count(*), count(*) FILTER (WHERE notification.kind = 'gift_received'),
		 count(*) FILTER (WHERE notification.kind = 'dating_match')
		FROM notifications notification
		WHERE notification.user_id = $1 AND notification.read_at IS NULL
			AND `+notificationModerationVisibilitySQL+`
			AND `+notificationUnblockedSQL, userID).Scan(&counts.Unread, &counts.Gifts, &counts.Matches)
	if err != nil {
		return Counts{}, fmt.Errorf("count unread notifications: %w", err)
	}
	err = r.db.QueryRowContext(ctx, `SELECT
 count(*) FILTER (WHERE share.recipient_id=$1 AND share.read_at IS NULL AND share.recipient_deleted_at IS NULL),
 count(*) FILTER (WHERE share.sender_id=$1 AND share.reply_emoji IS NOT NULL AND share.reply_read_at IS NULL AND share.sender_deleted_at IS NULL)
 FROM clip_shares share JOIN users peer ON peer.id=CASE WHEN share.sender_id=$1 THEN share.recipient_id ELSE share.sender_id END
 JOIN friendships f ON f.user_low_id=LEAST(share.sender_id,share.recipient_id) AND f.user_high_id=GREATEST(share.sender_id,share.recipient_id)
 WHERE ((share.sender_id=$1 AND share.sender_deleted_at IS NULL)
 OR (share.recipient_id=$1 AND share.recipient_deleted_at IS NULL))
 AND peer.moderation_suspended_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM user_blocks block WHERE (block.blocker_id=share.sender_id AND block.blocked_id=share.recipient_id)
 OR (block.blocker_id=share.recipient_id AND block.blocked_id=share.sender_id))
 AND EXISTS(SELECT 1 FROM posts post JOIN clips clip ON clip.post_id=post.id WHERE post.id=share.post_id
 AND post.moderation_hidden_at IS NULL AND post_age_visible(post.id,$1) AND profile_content_visible($1,post.author_user_id)
 AND (post.event_id IS NULL OR EXISTS(SELECT 1 FROM events event WHERE event.id=post.event_id AND event.moderation_hidden_at IS NULL))
 AND (post.author_user_id=$1 OR post.visibility='city' OR (post.visibility='friends' AND EXISTS
 (SELECT 1 FROM friendships friendship WHERE friendship.user_low_id=LEAST($1::bigint,post.author_user_id)
 AND friendship.user_high_id=GREATEST($1::bigint,post.author_user_id)))))`, userID).Scan(&counts.Clips, &counts.Messages)
	if err != nil {
		return Counts{}, fmt.Errorf("count clip messages: %w", err)
	}
	return counts, nil
}
