package social

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func (r *PostgresRepository) CreateFriendship(ctx context.Context, userID, targetID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin dating friendship: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := lockUsers(ctx, tx, userID, targetID); err != nil {
		return err
	}
	blocked, err := usersBlocked(ctx, tx, userID, targetID)
	if err != nil {
		return err
	}
	if blocked {
		return ErrBlocked
	}
	var ready int
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    count(DISTINCT identity.user_id)
		FROM user_identities identity
		    JOIN users u ON u.id = identity.user_id
		WHERE identity.user_id IN ($1, $2)
		    AND identity.status = 'verified'
		    AND u.moderation_suspended_at IS NULL
	`, userID, targetID).Scan(&ready); err != nil {
		return fmt.Errorf("check dating friendship users: %w", err)
	}
	if ready != 2 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO
		    friendships (user_low_id, user_high_id)
		VALUES
		    (LEAST($1::bigint, $2::bigint), GREATEST($1::bigint, $2::bigint))
		ON CONFLICT DO NOTHING
	`, userID, targetID); err != nil {
		return fmt.Errorf("create dating friendship: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM friend_requests
		WHERE (
		        requester_id = $1
		        AND addressee_id = $2
		    )
		    OR (
		        requester_id = $2
		        AND addressee_id = $1
		    )
	`, userID, targetID); err != nil {
		return fmt.Errorf("clear dating friend requests: %w", err)
	}
	return commit(tx, "dating friendship")
}

func (r *PostgresRepository) SendFriendRequest(ctx context.Context, userID, targetID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin friend request: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := lockUsers(ctx, tx, userID, targetID); err != nil {
		return err
	}
	var targetVerified bool
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM user_identities identity
		            JOIN users target ON target.id = identity.user_id
		        WHERE identity.user_id = $1
		            AND identity.status = 'verified'
		            AND target.moderation_suspended_at IS NULL
		    )
	`, targetID).Scan(&targetVerified); err != nil {
		return fmt.Errorf("check friend request target: %w", err)
	}
	if !targetVerified {
		return ErrNotFound
	}
	blocked, err := usersBlocked(ctx, tx, userID, targetID)
	if err != nil {
		return err
	}
	if blocked {
		return ErrBlocked
	}
	var friends, reverseRequest bool
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM friendships
		        WHERE user_low_id = LEAST($1::bigint, $2::bigint)
		            AND user_high_id = GREATEST($1::bigint, $2::bigint)
		    ),
		    EXISTS (
		        SELECT
		            1
		        FROM friend_requests
		        WHERE requester_id = $2
		            AND addressee_id = $1
		    )
	`, userID, targetID).Scan(&friends, &reverseRequest); err != nil {
		return fmt.Errorf("check friendship: %w", err)
	}
	if friends {
		return ErrAlreadyFriends
	}
	if reverseRequest {
		return ErrRequestExists
	}
	var requestCreatedAt time.Time
	err = tx.QueryRowContext(ctx, `
		INSERT INTO
		    friend_requests (requester_id, addressee_id)
		VALUES
		    ($1, $2)
		ON CONFLICT DO NOTHING
		RETURNING created_at
	`, userID, targetID).Scan(&requestCreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return commit(tx, "friend request")
	}
	if err != nil {
		return fmt.Errorf("create friend request: %w", err)
	}
	dedupeKey := fmt.Sprintf("friend_request:%d:%d:%d", userID, targetID, requestCreatedAt.UnixNano())
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO
		    background_jobs (kind, payload, dedupe_key, run_at)
		VALUES
		    (
		        'notification',
		        jsonb_build_object(
		            'user_id',
		            $1::bigint,
		            'kind',
		            'friend_request',
		            'title',
		            'Новая заявка в друзья',
		            'body',
		            'Вам отправили заявку в друзья.',
		            'actor_user_id',
		            $2::bigint,
		            'dedupe_key',
		            $3::text
		        ),
		        $3,
		        $4
		    )
		ON CONFLICT (dedupe_key) DO NOTHING
	`, targetID, userID, dedupeKey, requestCreatedAt); err != nil {
		return fmt.Errorf("enqueue friend request notification: %w", err)
	}
	return commit(tx, "friend request")
}

func (r *PostgresRepository) ListFriendRequests(ctx context.Context, userID int64, limit int) ([]FriendRequest, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
		    u.id,
		    u.username,
		    u.display_name,
		    u.city,
		    CASE
		        WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url
		        ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content'
		    END,
		    request.created_at
		FROM friend_requests request
		    JOIN users u ON u.id = request.requester_id
		    AND u.moderation_suspended_at IS NULL
		WHERE request.addressee_id = $1
		    AND EXISTS (
		        SELECT
		            1
		        FROM user_identities identity
		        WHERE identity.user_id = u.id
		            AND identity.status = 'verified'
		    )
		ORDER BY
		    request.created_at DESC,
		    request.requester_id
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list friend requests: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()
	items := []FriendRequest{}
	for rows.Next() {
		var item FriendRequest
		if err := scanUser(rows, &item.User, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan friend request: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) ListOutgoingFriendRequests(ctx context.Context, userID int64, limit int) ([]FriendRequest, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
		    u.id,
		    u.username,
		    u.display_name,
		    u.city,
		    CASE
		        WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url
		        ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content'
		    END,
		    request.created_at
		FROM friend_requests request
		    JOIN users u ON u.id = request.addressee_id
		    AND u.moderation_suspended_at IS NULL
		WHERE request.requester_id = $1
		    AND EXISTS (
		        SELECT
		            1
		        FROM user_identities identity
		        WHERE identity.user_id = u.id
		            AND identity.status = 'verified'
		    )
		ORDER BY
		    request.created_at DESC,
		    request.addressee_id
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list outgoing friend requests: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()
	items := []FriendRequest{}
	for rows.Next() {
		var item FriendRequest
		if err := scanUser(rows, &item.User, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan outgoing friend request: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) ResolveFriendRequest(
	ctx context.Context,
	userID, requesterID int64,
	accept bool,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin friend request resolution: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := lockUsers(ctx, tx, userID, requesterID); err != nil {
		return err
	}
	if accept {
		var requesterVerified bool
		if err := tx.QueryRowContext(ctx, `
			SELECT
			    EXISTS (
			        SELECT
			            1
			        FROM user_identities identity
			            JOIN users requester ON requester.id = identity.user_id
			        WHERE identity.user_id = $1
			            AND identity.status = 'verified'
			            AND requester.moderation_suspended_at IS NULL
			    )
		`, requesterID).Scan(&requesterVerified); err != nil {
			return fmt.Errorf("check friend request sender: %w", err)
		}
		if !requesterVerified {
			return ErrNotFound
		}
	}
	if accept {
		blocked, err := usersBlocked(ctx, tx, userID, requesterID)
		if err != nil {
			return err
		}
		if blocked {
			return ErrBlocked
		}
	}
	var requestCreatedAt time.Time
	err = tx.QueryRowContext(ctx,
		"DELETE FROM friend_requests WHERE requester_id = $1 AND addressee_id = $2 RETURNING created_at",
		requesterID, userID,
	).Scan(&requestCreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("resolve friend request: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE notifications
		SET read_at = COALESCE(read_at, now())
		WHERE user_id = $1
		    AND actor_user_id = $2
		    AND kind = 'friend_request'
		    AND read_at IS NULL
	`, userID, requesterID); err != nil {
		return fmt.Errorf("mark resolved friend request notification: %w", err)
	}
	if accept {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO
			    friendships (user_low_id, user_high_id)
			VALUES
			    (LEAST($1::bigint, $2::bigint), GREATEST($1::bigint, $2::bigint))
			ON CONFLICT DO NOTHING
		`,
			userID, requesterID,
		); err != nil {
			return fmt.Errorf("create friendship: %w", err)
		}
		dedupeKey := fmt.Sprintf("friend_request_accepted:%d:%d:%d", requesterID, userID, requestCreatedAt.UnixNano())
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO
			    background_jobs (kind, payload, dedupe_key, run_at)
			VALUES
			    (
			        'notification',
			        jsonb_build_object(
			            'user_id',
			            $1::bigint,
			            'kind',
			            'friend_request_accepted',
			            'title',
			            'Заявка принята',
			            'body',
			            'Вашу заявку в друзья приняли.',
			            'actor_user_id',
			            $2::bigint,
			            'dedupe_key',
			            $3::text
			        ),
			        $3,
			        now()
			    )
			ON CONFLICT (dedupe_key) DO NOTHING
		`, requesterID, userID, dedupeKey); err != nil {
			return fmt.Errorf("enqueue accepted friend request notification: %w", err)
		}
	}
	return commit(tx, "friend request resolution")
}

func (r *PostgresRepository) ListFriends(ctx context.Context, userID int64, limit int, before *FriendCursor) ([]Friend, error) {
	var beforeCreatedAt any
	var beforeUserID int64
	if before != nil {
		beforeCreatedAt = before.CreatedAt
		beforeUserID = before.UserID
	}
	rows, err := r.db.QueryContext(ctx, listFriendsSQL, userID, limit, beforeCreatedAt, beforeUserID)
	if err != nil {
		return nil, fmt.Errorf("list friends: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()
	items := []Friend{}
	for rows.Next() {
		var item Friend
		if err := scanUser(rows, &item.User,
			&item.User.MAXUserID,
			&item.User.MAXChatID,
			&item.User.LastSeenAt, &item.User.IsOnline, &item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan friend: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) ListBirthdayFriends(ctx context.Context, userID int64, limit int) ([]Friend, error) {
	rows, err := r.db.QueryContext(ctx, listBirthdayFriendsSQL, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list birthday friends: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()
	items := []Friend{}
	for rows.Next() {
		var item Friend
		var birthDate sql.NullTime
		if err := scanUser(rows, &item.User, &birthDate, &item.User.LastSeenAt, &item.User.IsOnline, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan birthday friend: %w", err)
		}
		if birthDate.Valid {
			item.User.BirthDate = birthDate.Time.Format("2006-01-02")
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate birthday friends: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) CountFriends(ctx context.Context, userID int64) (int64, error) {
	var count int64
	err := r.db.QueryRowContext(ctx, `
		SELECT
		    count(*)
		FROM friendships friendship
		    JOIN users u ON u.id = CASE
		        WHEN friendship.user_low_id = $1 THEN friendship.user_high_id
		        ELSE friendship.user_low_id
		    END
		WHERE (
		        friendship.user_low_id = $1
		        OR friendship.user_high_id = $1
		    )
		    AND u.moderation_suspended_at IS NULL
		    AND EXISTS (
		        SELECT
		            1
		        FROM user_identities identity
		        WHERE identity.user_id = u.id
		            AND identity.status = 'verified'
		    )
	`, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count friends: %w", err)
	}
	return count, nil
}

func (r *PostgresRepository) ListPublicFriends(ctx context.Context, viewerID, targetID int64, limit int, before *FriendCursor) ([]Friend, error) {
	var beforeCreatedAt any
	var beforeUserID int64
	if before != nil {
		beforeCreatedAt = before.CreatedAt
		beforeUserID = before.UserID
	}
	rows, err := r.db.QueryContext(ctx, listPublicFriendsSQL, viewerID, targetID, limit, beforeCreatedAt, beforeUserID)
	if err != nil {
		return nil, fmt.Errorf("list public friends: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()
	items := []Friend{}
	for rows.Next() {
		var item Friend
		if err := scanUser(rows, &item.User, &item.User.LastSeenAt, &item.User.IsOnline, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan public friend: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) DirectMessageTarget(ctx context.Context, userID, friendID int64) (DirectMessageTarget, error) {
	var target DirectMessageTarget
	err := r.db.QueryRowContext(ctx, `
		SELECT
		    COALESCE(
		        (
		            SELECT
		                identity.provider_user_id
		            FROM user_identities identity
		            WHERE identity.user_id = $2
		                AND identity.provider = 'max'
		                AND identity.status = 'verified'
		        ),
		        0
		    ),
		    COALESCE(
		        (
		            SELECT
		                (viewer.provider_user_id # friend.provider_user_id)::text
		            FROM user_identities viewer
		                JOIN user_identities friend ON friend.user_id = $2
		            WHERE viewer.user_id = $1
		                AND viewer.provider = 'max'
		                AND viewer.status = 'verified'
		                AND friend.provider = 'max'
		                AND friend.status = 'verified'
		        ),
		        ''
		    )
		FROM friendships friendship
		WHERE friendship.user_low_id = LEAST($1::bigint, $2::bigint)
		    AND friendship.user_high_id = GREATEST($1::bigint, $2::bigint)
		    AND EXISTS (
		        SELECT
		            1
		        FROM user_identities identity
		        WHERE identity.user_id = $2
		            AND identity.status = 'verified'
		    )
		    AND EXISTS (
		        SELECT
		            1
		        FROM users
		        WHERE id = $2
		            AND moderation_suspended_at IS NULL
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM user_blocks
		        WHERE (
		                blocker_id = $1
		                AND blocked_id = $2
		            )
		            OR (
		                blocker_id = $2
		                AND blocked_id = $1
		            )
		    )
	`,
		userID, friendID,
	).Scan(&target.MAXUserID, &target.MAXChatID)
	if errors.Is(err, sql.ErrNoRows) {
		return DirectMessageTarget{}, ErrFriendshipRequired
	}
	if err != nil {
		return DirectMessageTarget{}, fmt.Errorf("resolve friend direct message target: %w", err)
	}
	return target, nil
}

func (r *PostgresRepository) RemoveFriend(ctx context.Context, userID, friendID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin friendship removal: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := lockUsers(ctx, tx, userID, friendID); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
		DELETE FROM friendships
		WHERE user_low_id = LEAST($1::bigint, $2::bigint)
		    AND user_high_id = GREATEST($1::bigint, $2::bigint)
	`,
		userID, friendID,
	)
	if err != nil {
		return fmt.Errorf("remove friendship: %w", err)
	}
	removed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count removed friendship: %w", err)
	}

	if removed > 0 {
		blocked, err := usersBlocked(ctx, tx, userID, friendID)
		if err != nil {
			return err
		}
		if !blocked {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO
				    friend_requests (requester_id, addressee_id)
				VALUES
				    ($1, $2)
				ON CONFLICT DO NOTHING
			`, friendID, userID); err != nil {
				return fmt.Errorf("preserve incoming request after friendship removal: %w", err)
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM event_invitations
		WHERE (
		        sender_id = $1
		        AND recipient_id = $2
		    )
		    OR (
		        sender_id = $2
		        AND recipient_id = $1
		    )
	`, userID, friendID); err != nil {
		return fmt.Errorf("remove invitations after friendship removal: %w", err)
	}

	return commit(tx, "friendship removal")
}
