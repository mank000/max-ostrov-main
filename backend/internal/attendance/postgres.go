package attendance

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"kutezh/backend/internal/postgres"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) EventContext(ctx context.Context, userID, eventID int64) (EventContext, error) {
	var event EventContext
	err := r.db.QueryRowContext(ctx, `
		SELECT event.title, event.starts_at, event.ends_at, event.latitude, event.longitude, event.created_by_user_id
		FROM events event
		JOIN event_participants participant
			ON participant.event_id = event.id AND participant.user_id = $1
		WHERE event.id = $2 AND event.moderation_hidden_at IS NULL`, userID, eventID,
	).Scan(&event.Title, &event.StartsAt, &event.EndsAt, &event.Latitude, &event.Longitude, &event.OrganizerID)
	if errors.Is(err, sql.ErrNoRows) {
		var exists bool
		if checkErr := r.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM events WHERE id = $1)", eventID).Scan(&exists); checkErr != nil {
			return EventContext{}, fmt.Errorf("check attendance event: %w", checkErr)
		}
		if exists {
			return EventContext{}, ErrParticipationRequired
		}
		return EventContext{}, ErrNotFound
	}
	if err != nil {
		return EventContext{}, fmt.Errorf("get attendance event: %w", err)
	}
	return event, nil
}

func (r *PostgresRepository) ListForOrganizer(ctx context.Context, organizerID, eventID int64) ([]Confirmation, error) {
	var ownerID sql.NullInt64
	err := r.db.QueryRowContext(ctx, `SELECT created_by_user_id FROM events WHERE id = $1 AND moderation_hidden_at IS NULL`, eventID).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("check attendance event organizer: %w", err)
	}
	if !ownerID.Valid || ownerID.Int64 != organizerID {
		return nil, ErrOrganizerRequired
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT confirmation.event_id, confirmation.user_id, confirmation.status,
			confirmation.location_matched, confirmation.evidence_submitted_at,
			confirmation.reviewed_by_user_id, confirmation.reviewed_at,
			COALESCE(array_agg(media.media_id ORDER BY media.position)
				FILTER (WHERE media.media_id IS NOT NULL), '{}'::bigint[])
		FROM attendance_confirmations confirmation
		LEFT JOIN attendance_media media ON media.event_id = confirmation.event_id AND media.user_id = confirmation.user_id
		WHERE confirmation.event_id = $1
		GROUP BY confirmation.event_id, confirmation.user_id
		ORDER BY confirmation.evidence_submitted_at DESC, confirmation.user_id DESC
		LIMIT 200`, eventID)
	if err != nil {
		return nil, fmt.Errorf("list attendance confirmations: %w", err)
	}
	defer func() { _ = rows.Close() }()
	confirmations := make([]Confirmation, 0)
	for rows.Next() {
		var confirmation Confirmation
		if err := rows.Scan(
			&confirmation.EventID, &confirmation.UserID, &confirmation.Status,
			&confirmation.LocationMatched, &confirmation.EvidenceSubmittedAt,
			&confirmation.ReviewedByUserID, &confirmation.ReviewedAt, &confirmation.MediaIDs,
		); err != nil {
			return nil, fmt.Errorf("scan attendance confirmation: %w", err)
		}
		confirmations = append(confirmations, confirmation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate attendance confirmations: %w", err)
	}
	return confirmations, nil
}

func (r *PostgresRepository) Submit(
	ctx context.Context,
	userID, eventID int64,
	input EvidenceInput,
	status Status,
	locationMatched bool,
	now time.Time,
) (Confirmation, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Confirmation{}, fmt.Errorf("begin attendance submission: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if existing, existingErr := getConfirmation(ctx, tx, userID, eventID); existingErr == nil {
		return existing, tx.Commit()
	} else if !errors.Is(existingErr, ErrNotFound) {
		return Confirmation{}, existingErr
	}

	var withinWindow bool
	err = tx.QueryRowContext(ctx, `SELECT $3::timestamptz >= event.starts_at - interval '2 hours'
		AND $3::timestamptz <= COALESCE(event.ends_at, event.starts_at + interval '4 hours') + interval '12 hours'
		FROM events event JOIN event_participants participant ON participant.event_id = event.id
		WHERE event.id = $2 AND event.moderation_hidden_at IS NULL AND participant.user_id = $1
		FOR SHARE OF event, participant`, userID, eventID, now).Scan(&withinWindow)
	if errors.Is(err, sql.ErrNoRows) {
		return Confirmation{}, ErrParticipationRequired
	}
	if err != nil {
		return Confirmation{}, fmt.Errorf("lock attendance participation: %w", err)
	}
	if !withinWindow {
		return Confirmation{}, ErrOutsideWindow
	}

	if len(input.MediaIDs) > 0 {
		if err := postgres.LockMediaAssets(ctx, tx, userID, input.MediaIDs); err != nil {
			return Confirmation{}, err
		}
		var count int
		err = tx.QueryRowContext(ctx, `
			SELECT count(*) FROM (
				SELECT media.id FROM media_assets media
				WHERE media.id = ANY($1::bigint[]) AND media.owner_user_id = $2
					AND media.moderated_safe
					AND media.mime_type IN ('image/jpeg', 'image/png')
					AND NOT EXISTS (SELECT 1 FROM post_media WHERE media_id = media.id)
					AND NOT EXISTS (SELECT 1 FROM comment_media WHERE media_id = media.id)
					AND NOT EXISTS (SELECT 1 FROM attendance_media WHERE media_id = media.id)
					AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_media_id = media.id)
			) available`,
			input.MediaIDs, userID,
		).Scan(&count)
		if err != nil {
			return Confirmation{}, fmt.Errorf("validate attendance media: %w", err)
		}
		if count != len(input.MediaIDs) {
			return Confirmation{}, ErrInvalidMedia
		}
	}

	var inserted bool
	err = tx.QueryRowContext(ctx, `
		WITH created AS (
			INSERT INTO attendance_confirmations (
				event_id, user_id, status, location_matched, evidence_submitted_at
			) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (event_id, user_id) DO NOTHING
			RETURNING 1
		)
		SELECT EXISTS (SELECT 1 FROM created)`, eventID, userID, status, locationMatched, now,
	).Scan(&inserted)
	if err != nil {
		return Confirmation{}, fmt.Errorf("create attendance confirmation: %w", err)
	}
	if !inserted {
		confirmation, getErr := getConfirmation(ctx, tx, userID, eventID)
		if getErr != nil {
			return Confirmation{}, getErr
		}
		return confirmation, tx.Commit()
	}
	if inserted && len(input.MediaIDs) > 0 {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO attendance_media (event_id, user_id, media_id, position)
			SELECT $1, $2, value, position - 1
			FROM unnest($3::bigint[]) WITH ORDINALITY AS item(value, position)`, eventID, userID, input.MediaIDs)
		if err != nil {
			return Confirmation{}, fmt.Errorf("attach attendance media: %w", err)
		}
	}
	if inserted && status == StatusPending {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO background_jobs (kind, payload, dedupe_key, run_at)
			SELECT 'notification', jsonb_build_object(
				'user_id', event.created_by_user_id,
				'kind', 'attendance_review',
				'title', 'Нужно проверить посещение',
				'body', 'Участник отправил подтверждение посещения мероприятия «' || event.title || '».',
				'event_id', event.id,
				'actor_user_id', $2::bigint,
				'dedupe_key', 'attendance_review:' || event.id::text || ':' || $2::bigint::text
			), 'attendance_review:' || event.id::text || ':' || $2::bigint::text, $3
			FROM events event
			WHERE event.id = $1 AND event.created_by_user_id IS NOT NULL
				AND event.created_by_user_id <> $2
			ON CONFLICT (dedupe_key) DO NOTHING`, eventID, userID, now)
		if err != nil {
			return Confirmation{}, fmt.Errorf("enqueue attendance review: %w", err)
		}
	}
	if inserted && status == StatusConfirmed {
		if err := creditAttendanceReward(ctx, tx, userID, eventID, now); err != nil {
			return Confirmation{}, err
		}
	}
	confirmation, err := getConfirmation(ctx, tx, userID, eventID)
	if err != nil {
		return Confirmation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Confirmation{}, fmt.Errorf("commit attendance submission: %w", err)
	}
	return confirmation, nil
}

func (r *PostgresRepository) Get(ctx context.Context, userID, eventID int64) (Confirmation, error) {
	return getConfirmation(ctx, r.db, userID, eventID)
}

func (r *PostgresRepository) Review(
	ctx context.Context,
	reviewerID, eventID, userID int64,
	status Status,
	now time.Time,
) (Confirmation, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Confirmation{}, fmt.Errorf("begin attendance review: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `
		UPDATE attendance_confirmations confirmation
		SET status = $4, reviewed_by_user_id = $1, reviewed_at = $5
		FROM events event
		WHERE confirmation.event_id = $2 AND confirmation.user_id = $3
			AND confirmation.status = 'pending'
			AND event.id = confirmation.event_id AND event.created_by_user_id = $1
			AND event.moderation_hidden_at IS NULL`,
		reviewerID, eventID, userID, status, now,
	)
	if err != nil {
		return Confirmation{}, fmt.Errorf("review attendance: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return Confirmation{}, fmt.Errorf("read attendance review: %w", err)
	}
	if updated == 0 {
		var organizer bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (SELECT 1 FROM events WHERE id = $1 AND created_by_user_id = $2)`,
			eventID, reviewerID,
		).Scan(&organizer); err != nil {
			return Confirmation{}, fmt.Errorf("check attendance organizer: %w", err)
		}
		if !organizer {
			return Confirmation{}, ErrOrganizerRequired
		}
		return Confirmation{}, ErrNotFound
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO background_jobs (kind, payload, dedupe_key, run_at)
		SELECT 'notification', jsonb_build_object(
			'user_id', $3::bigint,
			'kind', 'attendance_result',
			'title', CASE WHEN $4 = 'confirmed' THEN 'Посещение подтверждено' ELSE 'Подтверждение отклонено' END,
			'body', CASE WHEN $4 = 'confirmed'
				THEN 'Посещение мероприятия «' || event.title || '» подтверждено.'
				ELSE 'Подтверждение посещения мероприятия «' || event.title || '» отклонено.' END,
			'event_id', event.id,
			'actor_user_id', $1::bigint,
			'dedupe_key', 'attendance_result:' || event.id::text || ':' || $3::bigint::text || ':' || $4::text
		), 'attendance_result:' || event.id::text || ':' || $3::bigint::text || ':' || $4::text, $5
		FROM events event WHERE event.id = $2
		ON CONFLICT (dedupe_key) DO NOTHING`, reviewerID, eventID, userID, status, now)
	if err != nil {
		return Confirmation{}, fmt.Errorf("enqueue attendance result: %w", err)
	}
	if status == StatusConfirmed {
		if err := creditAttendanceReward(ctx, tx, userID, eventID, now); err != nil {
			return Confirmation{}, err
		}
	}
	confirmation, err := getConfirmation(ctx, tx, userID, eventID)
	if err != nil {
		return Confirmation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Confirmation{}, fmt.Errorf("commit attendance review: %w", err)
	}
	return confirmation, nil
}

func creditAttendanceReward(ctx context.Context, tx *sql.Tx, userID, eventID int64, now time.Time) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO coin_transactions (
			user_id, amount, kind, description, reference_type, reference_id, idempotency_key, created_at
		) VALUES ($1, 50, 'attendance_reward', 'Награда за подтверждённое посещение',
			'event', $2::bigint::text, 'attendance:' || $2::bigint::text || ':' || $1::bigint::text, $3)
		ON CONFLICT (user_id, idempotency_key) DO NOTHING`, userID, eventID, now)
	if err != nil {
		return fmt.Errorf("credit attendance reward: %w", err)
	}
	return nil
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func getConfirmation(ctx context.Context, database queryer, userID, eventID int64) (Confirmation, error) {
	var confirmation Confirmation
	err := database.QueryRowContext(ctx, `
		SELECT confirmation.event_id, confirmation.user_id, confirmation.status,
			confirmation.location_matched, confirmation.evidence_submitted_at,
			confirmation.reviewed_by_user_id, confirmation.reviewed_at,
			COALESCE(array_agg(media.media_id ORDER BY media.position)
				FILTER (WHERE media.media_id IS NOT NULL), '{}'::bigint[])
		FROM attendance_confirmations confirmation
		LEFT JOIN attendance_media media
			ON media.event_id = confirmation.event_id AND media.user_id = confirmation.user_id
		WHERE confirmation.event_id = $2 AND confirmation.user_id = $1
			AND EXISTS (SELECT 1 FROM events event WHERE event.id=confirmation.event_id
				AND event.moderation_hidden_at IS NULL)
		GROUP BY confirmation.event_id, confirmation.user_id`, userID, eventID,
	).Scan(
		&confirmation.EventID, &confirmation.UserID, &confirmation.Status,
		&confirmation.LocationMatched, &confirmation.EvidenceSubmittedAt,
		&confirmation.ReviewedByUserID, &confirmation.ReviewedAt, &confirmation.MediaIDs,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Confirmation{}, ErrNotFound
	}
	if err != nil {
		return Confirmation{}, fmt.Errorf("get attendance confirmation: %w", err)
	}
	return confirmation, nil
}
