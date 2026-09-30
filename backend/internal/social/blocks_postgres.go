package social

import (
	"context"
	"fmt"
)

func (r *PostgresRepository) Block(ctx context.Context, userID, blockedID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin block: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockUsers(ctx, tx, userID, blockedID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, userID, blockedID); err != nil {
		return fmt.Errorf("block user: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM friend_requests
		WHERE (requester_id = $1 AND addressee_id = $2)
			OR (requester_id = $2 AND addressee_id = $1)`, userID, blockedID); err != nil {
		return fmt.Errorf("remove blocked friend requests: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM friendships
		WHERE user_low_id = LEAST($1::bigint, $2::bigint)
			AND user_high_id = GREATEST($1::bigint, $2::bigint)
	`, userID, blockedID); err != nil {
		return fmt.Errorf("remove blocked friendship: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM event_invitations
		WHERE (sender_id = $1 AND recipient_id = $2)
			OR (sender_id = $2 AND recipient_id = $1)`, userID, blockedID); err != nil {
		return fmt.Errorf("remove blocked event invitations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM group_invitations
		WHERE (invited_by_user_id = $1 AND user_id = $2)
			OR (invited_by_user_id = $2 AND user_id = $1)`, userID, blockedID); err != nil {
		return fmt.Errorf("remove blocked group invitations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM group_join_requests request
		USING event_groups group_record
		WHERE request.group_id = group_record.id
			AND ((request.user_id = $1 AND group_record.leader_user_id = $2)
				OR (request.user_id = $2 AND group_record.leader_user_id = $1))`, userID, blockedID); err != nil {
		return fmt.Errorf("remove blocked group requests: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM group_merge_requests request
		USING group_members source, group_members target
		WHERE source.group_id = request.source_group_id AND target.group_id = request.target_group_id
			AND ((source.user_id = $1 AND target.user_id = $2)
				OR (source.user_id = $2 AND target.user_id = $1))`, userID, blockedID); err != nil {
		return fmt.Errorf("remove blocked group merge requests: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_follows WHERE (follower_id=$1 AND followed_id=$2) OR (follower_id=$2 AND followed_id=$1)`, userID, blockedID); err != nil {
		return fmt.Errorf("remove blocked follows: %w", err)
	}
	return commit(tx, "block")
}

func (r *PostgresRepository) Unblock(ctx context.Context, userID, blockedID int64) error {
	_, err := r.db.ExecContext(ctx,
		"DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", userID, blockedID,
	)
	if err != nil {
		return fmt.Errorf("unblock user: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListBlocked(ctx context.Context, userID int64, limit int) ([]BlockedUser, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT u.id, u.username, u.display_name, u.city,
			CASE WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content' END,
			block.created_at
		FROM user_blocks block
		JOIN users u ON u.id = block.blocked_id
		WHERE block.blocker_id = $1
		ORDER BY block.created_at DESC, block.blocked_id
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list blocked users: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []BlockedUser{}
	for rows.Next() {
		var item BlockedUser
		if err := scanUser(rows, &item.User, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan blocked user: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
