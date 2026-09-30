package social

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func (r *PostgresRepository) InviteToEvent(
	ctx context.Context,
	senderID, eventID, recipientID int64,
	now time.Time,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin event invitation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockUsers(ctx, tx, senderID, recipientID); err != nil {
		return err
	}
	blocked, err := usersBlocked(ctx, tx, senderID, recipientID)
	if err != nil {
		return err
	}
	if blocked {
		return ErrBlocked
	}
	var friends bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM friendships
			WHERE user_low_id = LEAST($1::bigint, $2::bigint)
				AND user_high_id = GREATEST($1::bigint, $2::bigint))`,
		senderID, recipientID,
	).Scan(&friends); err != nil {
		return fmt.Errorf("check friendship for event invitation: %w", err)
	}
	if !friends {
		return ErrFriendshipRequired
	}
	var active, senderParticipates, recipientParticipates bool
	err = tx.QueryRowContext(ctx, `
		SELECT COALESCE(e.ends_at, e.starts_at) >= $2,
			(COALESCE(e.created_by_user_id = $3, false) OR EXISTS (
				SELECT 1 FROM event_participants WHERE event_id = e.id AND user_id = $3
			)),
			(COALESCE(e.created_by_user_id = $4, false) OR EXISTS (
				SELECT 1 FROM event_participants WHERE event_id = e.id AND user_id = $4
			))
		FROM events e WHERE e.id = $1`, eventID, now, senderID, recipientID,
	).Scan(&active, &senderParticipates, &recipientParticipates)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("check event invitation: %w", err)
	}
	if !active {
		return ErrEventEnded
	}
	if !senderParticipates {
		return ErrParticipationRequired
	}
	if recipientParticipates {
		return ErrAlreadyParticipating
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO event_invitations (event_id, sender_id, recipient_id)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, eventID, senderID, recipientID)
	if err != nil {
		return fmt.Errorf("create event invitation: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read event invitation result: %w", err)
	}
	if inserted > 0 {
		var eventTitle string
		if err := tx.QueryRowContext(ctx, "SELECT title FROM events WHERE id = $1", eventID).Scan(&eventTitle); err != nil {
			return fmt.Errorf("read invited event title: %w", err)
		}
		dedupeKey := fmt.Sprintf("event-invitation:%d:%d:%d:%d", eventID, senderID, recipientID, now.UnixNano())
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO background_jobs (kind, payload, dedupe_key, run_at)
			VALUES ('notification', jsonb_build_object(
				'user_id', $1::bigint,
				'kind', 'event_invitation',
				'title', 'Приглашение на мероприятие',
				'body', $2::text,
				'event_id', $3::bigint,
				'actor_user_id', $4::bigint,
				'dedupe_key', $5::text
			), $5, $6)`,
			recipientID, fmt.Sprintf("Вас пригласили на «%s».", eventTitle), eventID, senderID, dedupeKey, now,
		); err != nil {
			return fmt.Errorf("queue event invitation notification: %w", err)
		}
	}
	return commit(tx, "event invitation")
}

func (r *PostgresRepository) ListEventInvitations(
	ctx context.Context,
	userID int64,
	now time.Time,
	limit int,
) ([]EventInvitation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT invitation.event_id, e.title, e.starts_at,
			u.id, u.username, u.display_name, u.city,
			CASE WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content' END,
			invitation.created_at
		FROM event_invitations invitation
		JOIN events e ON e.id = invitation.event_id
		JOIN users u ON u.id = invitation.sender_id
		WHERE invitation.recipient_id = $1
			AND COALESCE(e.ends_at, e.starts_at) >= $2
		ORDER BY e.starts_at, invitation.created_at DESC
		LIMIT $3`, userID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list event invitations: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []EventInvitation{}
	for rows.Next() {
		var item EventInvitation
		if err := rows.Scan(&item.EventID, &item.EventTitle, &item.StartsAt,
			&item.Sender.ID, &item.Sender.Username, &item.Sender.DisplayName,
			&item.Sender.City, &item.Sender.PhotoURL, &item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan event invitation: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) ResolveEventInvitation(
	ctx context.Context,
	recipientID, eventID, senderID int64,
	accept bool,
	now time.Time,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin event invitation resolution: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockUsers(ctx, tx, recipientID, senderID); err != nil {
		return err
	}
	var active, recipientIsOrganizer bool
	err = tx.QueryRowContext(ctx, `
		SELECT COALESCE(e.ends_at, e.starts_at) >= $4, COALESCE(e.created_by_user_id = $3, false)
		FROM event_invitations invitation
		JOIN events e ON e.id = invitation.event_id
		WHERE invitation.event_id = $1 AND invitation.sender_id = $2
			AND invitation.recipient_id = $3
		FOR UPDATE OF invitation`, eventID, senderID, recipientID, now,
	).Scan(&active, &recipientIsOrganizer)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("get event invitation: %w", err)
	}
	if !active && accept {
		return ErrEventEnded
	}
	if accept {
		if recipientIsOrganizer {
			return ErrAlreadyParticipating
		}
		blocked, err := usersBlocked(ctx, tx, recipientID, senderID)
		if err != nil {
			return err
		}
		if blocked {
			return ErrBlocked
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO event_participants (user_id, event_id)
			VALUES ($1, $2) ON CONFLICT DO NOTHING`, recipientID, eventID); err != nil {
			return fmt.Errorf("accept event invitation: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO background_jobs (kind, payload, dedupe_key, run_at)
			SELECT 'notification', jsonb_build_object(
				'user_id', $1::bigint,
				'kind', 'event_reminder',
				'title', 'Мероприятие уже скоро',
				'body', 'Не забудьте про мероприятие «' || title || '».',
				'event_id', id,
				'dedupe_key', 'event_reminder:' || id::text || ':' || $1::bigint::text
			), 'event_reminder:' || id::text || ':' || $1::bigint::text,
				GREATEST($3, starts_at - interval '24 hours')
			FROM events WHERE id = $2
			ON CONFLICT (dedupe_key) DO NOTHING`, recipientID, eventID, now); err != nil {
			return fmt.Errorf("schedule invited participant reminder: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			"DELETE FROM event_invitations WHERE event_id = $1 AND recipient_id = $2",
			eventID, recipientID,
		); err != nil {
			return fmt.Errorf("remove resolved event invitations: %w", err)
		}
	} else if _, err := tx.ExecContext(ctx, `
		DELETE FROM event_invitations
		WHERE event_id = $1 AND sender_id = $2 AND recipient_id = $3`,
		eventID, senderID, recipientID,
	); err != nil {
		return fmt.Errorf("decline event invitation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE notifications
		SET read_at = COALESCE(read_at, $4)
		WHERE user_id = $1 AND event_id = $2 AND kind = 'event_invitation' AND read_at IS NULL
			AND ($5 OR actor_user_id = $3)`,
		recipientID, eventID, senderID, now, accept,
	); err != nil {
		return fmt.Errorf("mark event invitation notification read: %w", err)
	}
	return commit(tx, "event invitation resolution")
}
