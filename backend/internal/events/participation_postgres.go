package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func (r *PostgresRepository) SetParticipation(
	ctx context.Context,
	userID, eventID int64,
	participating bool,
	now time.Time,
) error {
	if !participating {
		var exists bool
		err := r.db.QueryRowContext(ctx, `
			WITH target AS (SELECT id FROM events WHERE id = $2), removed AS (
				DELETE FROM event_participants WHERE user_id = $1 AND event_id = $2 RETURNING 1
			), reminders AS (
				DELETE FROM background_jobs
				WHERE dedupe_key = 'event_reminder:' || $2::bigint::text || ':' || $1::bigint::text
					AND finished_at IS NULL
			), invitations AS (
				DELETE FROM event_invitations WHERE sender_id = $1 AND event_id = $2
			), group_requests AS (
				DELETE FROM group_join_requests WHERE user_id = $1
					AND group_id IN (SELECT id FROM event_groups WHERE event_id = $2)
			), group_invitations AS (
				DELETE FROM group_invitations WHERE user_id = $1
					AND group_id IN (SELECT id FROM event_groups WHERE event_id = $2)
			)
			SELECT EXISTS (SELECT 1 FROM target)`, userID, eventID).Scan(&exists)
		if err != nil {
			var postgresError *pgconn.PgError
			if errors.As(err, &postgresError) && postgresError.Code == "23503" {
				return ErrGroupMembership
			}
			return fmt.Errorf("leave event: %w", err)
		}
		if !exists {
			return ErrNotFound
		}
		return nil
	}

	const query = `
		WITH target AS (
			SELECT id, title, starts_at, COALESCE(ends_at, starts_at) >= $3 AS active
			FROM events WHERE id = $2 AND moderation_hidden_at IS NULL
		), inserted AS (
			INSERT INTO event_participants (user_id, event_id)
			SELECT $1, id FROM target WHERE active
			ON CONFLICT (user_id, event_id) DO NOTHING
			RETURNING 1
		), invitations AS (
			DELETE FROM event_invitations WHERE recipient_id = $1 AND event_id = $2
				AND EXISTS (SELECT 1 FROM target WHERE active)
		), reminder AS (
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
			FROM target WHERE active
			ON CONFLICT (dedupe_key) DO NOTHING
		)
		SELECT active FROM target`
	var active bool
	if err := r.db.QueryRowContext(ctx, query, userID, eventID, now).Scan(&active); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return fmt.Errorf("set event participation: %w", err)
	}
	if !active {
		return ErrEventEnded
	}
	return nil
}

func (r *PostgresRepository) SetSaved(ctx context.Context, userID, eventID int64, saved bool) error {
	if !saved {
		const query = `
			WITH target AS (SELECT id FROM events WHERE id = $2), deleted AS (
				DELETE FROM saved_events relation
				USING target
				WHERE relation.user_id = $1 AND relation.event_id = target.id
				RETURNING 1
			)
			SELECT EXISTS (SELECT 1 FROM target)`
		var exists bool
		if err := r.db.QueryRowContext(ctx, query, userID, eventID).Scan(&exists); err != nil {
			return fmt.Errorf("remove saved event: %w", err)
		}
		if !exists {
			return ErrNotFound
		}
		return nil
	}

	const query = `
		WITH target AS (SELECT id FROM events WHERE id = $2 AND moderation_hidden_at IS NULL), inserted AS (
			INSERT INTO saved_events (user_id, event_id)
			SELECT $1, id FROM target
			ON CONFLICT (user_id, event_id) DO NOTHING
			RETURNING 1
		)
		SELECT EXISTS (SELECT 1 FROM target)`
	var exists bool
	if err := r.db.QueryRowContext(ctx, query, userID, eventID).Scan(&exists); err != nil {
		return fmt.Errorf("save event: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}
