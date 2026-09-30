package moderation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"kutezh/backend/internal/postgres"
	"strings"
	"time"
	"unicode/utf8"
)

const reportColumns = `id, reporter_user_id, target_type, target_id, reason, target_snapshot,
	status, version, reviewed_by_user_id, reviewed_at, created_at`

func scanReport(row interface{ Scan(...any) error }) (Report, error) {
	var report Report
	var reporterID, reviewerID sql.NullInt64
	var reviewedAt sql.NullTime
	err := row.Scan(&report.ID, &reporterID, &report.TargetType, &report.TargetID, &report.Reason,
		&report.TargetSnapshot, &report.Status, &report.Version, &reviewerID, &reviewedAt, &report.CreatedAt)
	if err != nil {
		return Report{}, err
	}
	if reporterID.Valid {
		report.ReporterUserID = &reporterID.Int64
	}
	if reviewerID.Valid {
		report.ReviewedByUserID = &reviewerID.Int64
	}
	if reviewedAt.Valid {
		report.ReviewedAt = &reviewedAt.Time
	}
	return report, nil
}

func (s *Service) CreateReport(ctx context.Context, reporterID int64, input ReportInput) (Report, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	if reporterID <= 0 || !input.TargetType.Valid() || input.TargetID <= 0 ||
		utf8.RuneCountInString(input.Reason) < 3 || utf8.RuneCountInString(input.Reason) > 500 {
		return Report{}, ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Report{}, fmt.Errorf("begin report: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := postgres.LockRow(ctx, tx, postgres.ReportLock, reporterID); err != nil {
		return Report{}, fmt.Errorf("lock report rate limit: %w", err)
	}
	var recent int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM moderation_reports
		WHERE reporter_user_id = $1 AND created_at > $2`, reporterID, s.now().Add(-time.Hour)).Scan(&recent); err != nil {
		return Report{}, fmt.Errorf("check report limit: %w", err)
	}
	if recent >= 10 {
		return Report{}, ErrRateLimited
	}
	snapshot, err := reportTargetSnapshot(ctx, tx, reporterID, input.TargetType, input.TargetID)
	if err != nil {
		return Report{}, err
	}
	report, err := scanReport(tx.QueryRowContext(ctx, `
		INSERT INTO moderation_reports(reporter_user_id,target_type,target_id,reason,target_snapshot)
		VALUES($1,$2,$3,$4,$5)
		RETURNING `+reportColumns,
		reporterID, input.TargetType, input.TargetID, input.Reason, snapshot))
	if err != nil {
		return Report{}, fmt.Errorf("create report: %w", err)
	}
	var evidence struct {
		MediaIDs []int64 `json:"media_ids"`
	}
	if err := json.Unmarshal(snapshot, &evidence); err != nil {
		return Report{}, fmt.Errorf("decode report media references: %w", err)
	}
	if len(evidence.MediaIDs) > 0 {
		result, err := tx.ExecContext(ctx, `
			INSERT INTO moderation_evidence_media(report_id,media_id)
			SELECT $1, media.id FROM media_assets media WHERE media.id=ANY($2::bigint[])`,
			report.ID, evidence.MediaIDs)
		if err != nil {
			return Report{}, fmt.Errorf("retain report media: %w", err)
		}
		count, err := result.RowsAffected()
		if err != nil {
			return Report{}, fmt.Errorf("count retained report media: %w", err)
		}
		if count != int64(len(evidence.MediaIDs)) {
			return Report{}, ErrNotFound
		}
	}
	if err := tx.Commit(); err != nil {
		return Report{}, fmt.Errorf("commit report: %w", err)
	}
	return report, nil
}

func reportTargetSnapshot(ctx context.Context, tx *sql.Tx, reporterID int64, targetType TargetType, targetID int64) (json.RawMessage, error) {
	var query string
	switch targetType {
	case TargetUser:
		query = `SELECT jsonb_build_object('id', u.id, 'display_name', u.display_name,
			'username', u.username, 'photo_url', CASE WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url
			ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content' END,
			'media_ids', CASE WHEN u.avatar_media_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(u.avatar_media_id) END)
			FROM users u WHERE u.id=$2 AND u.id<>$1`
	case TargetEvent:
		query = `SELECT jsonb_build_object('id', e.id, 'title', e.title,
			'description', e.description, 'city', e.city, 'created_by_user_id', e.created_by_user_id,
   'media_ids', to_jsonb(ARRAY(SELECT DISTINCT id FROM unnest(ARRAY[e.header_media_id,e.icon_media_id]) id WHERE id IS NOT NULL)))
			FROM events e WHERE e.id=$2 AND e.moderation_hidden_at IS NULL
				AND e.created_by_user_id IS DISTINCT FROM $1`
	case TargetPost:
		query = `SELECT jsonb_build_object('id', p.id, 'author_user_id', p.author_user_id,
			'author_display_name', author.display_name, 'author_username', COALESCE(author.username, ''),
			'caption', p.caption, 'visibility', p.visibility, 'city', p.city,
			'media_ids', COALESCE((SELECT jsonb_agg(media_id ORDER BY position)
				FROM post_media WHERE post_id=p.id), '[]'::jsonb))
			FROM posts p JOIN users author ON author.id=p.author_user_id
			WHERE p.id=$2 AND p.author_user_id<>$1
				AND p.moderation_hidden_at IS NULL
				AND (p.visibility='city'
					OR (p.visibility='friends' AND EXISTS(SELECT 1 FROM friendships f
						WHERE f.user_low_id=LEAST($1::bigint,p.author_user_id)
							AND f.user_high_id=GREATEST($1::bigint,p.author_user_id)))
					OR (p.visibility='event' AND EXISTS(SELECT 1 FROM events e
						WHERE e.id=p.event_id AND e.moderation_hidden_at IS NULL
							AND (e.created_by_user_id=$1 OR EXISTS(SELECT 1 FROM event_participants ep
								WHERE ep.user_id=$1 AND ep.event_id=e.id)))))
				AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
					(b.blocker_id=$1 AND b.blocked_id=p.author_user_id)
					OR (b.blocker_id=p.author_user_id AND b.blocked_id=$1))`
	case TargetComment:
		query = `SELECT jsonb_build_object('id', c.id, 'post_id', c.post_id,
			'author_user_id', c.author_user_id, 'body', c.body,
			'media_ids', COALESCE((SELECT jsonb_agg(media_id ORDER BY position)
				FROM comment_media WHERE comment_id=c.id), '[]'::jsonb))
			FROM post_comments c JOIN posts p ON p.id=c.post_id
			WHERE c.id=$2 AND c.author_user_id<>$1 AND c.moderation_hidden_at IS NULL
				AND p.moderation_hidden_at IS NULL
				AND (p.visibility='city'
					OR (p.visibility='friends' AND EXISTS(SELECT 1 FROM friendships f
						WHERE f.user_low_id=LEAST($1::bigint,p.author_user_id)
							AND f.user_high_id=GREATEST($1::bigint,p.author_user_id)))
					OR (p.visibility='event' AND EXISTS(SELECT 1 FROM events e
						WHERE e.id=p.event_id AND e.moderation_hidden_at IS NULL
							AND (e.created_by_user_id=$1 OR EXISTS(SELECT 1 FROM event_participants ep
								WHERE ep.user_id=$1 AND ep.event_id=e.id)))))
				AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
					(b.blocker_id=$1 AND b.blocked_id=c.author_user_id)
					OR (b.blocker_id=c.author_user_id AND b.blocked_id=$1)
					OR (b.blocker_id=$1 AND b.blocked_id=p.author_user_id)
					OR (b.blocker_id=p.author_user_id AND b.blocked_id=$1))`
	default:
		return nil, ErrInvalid
	}
	var snapshot json.RawMessage
	if err := tx.QueryRowContext(ctx, query, reporterID, targetID).Scan(&snapshot); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, fmt.Errorf("load reported target: %w", err)
	}
	return snapshot, nil
}
