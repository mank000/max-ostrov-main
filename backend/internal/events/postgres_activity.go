package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func (r *PostgresRepository) History(
	ctx context.Context,
	userID int64,
	view HistoryView,
	now time.Time,
	limit int,
) ([]HistoryItem, error) {
	var condition, order string
	switch view {
	case HistoryUpcoming:
		condition = "participant.user_id IS NOT NULL AND COALESCE(e.ends_at, e.starts_at) >= $2"
		order = "e.starts_at, e.id"
	case HistoryPast:
		condition = "participant.user_id IS NOT NULL AND COALESCE(e.ends_at, e.starts_at) < $2"
		order = "e.starts_at DESC, e.id DESC"
	case HistorySaved:
		condition = "saved.user_id IS NOT NULL"
		order = `CASE WHEN COALESCE(e.ends_at, e.starts_at) >= $2 THEN 0 ELSE 1 END,
			CASE WHEN COALESCE(e.ends_at, e.starts_at) >= $2 THEN e.starts_at END,
			CASE WHEN COALESCE(e.ends_at, e.starts_at) < $2 THEN e.starts_at END DESC,
			e.id`
	case HistoryCreated:
		condition = "e.created_by_user_id = $1"
		order = `CASE WHEN COALESCE(e.ends_at, e.starts_at) >= $2 THEN 0 ELSE 1 END,
			CASE WHEN COALESCE(e.ends_at, e.starts_at) >= $2 THEN e.starts_at END,
			CASE WHEN COALESCE(e.ends_at, e.starts_at) < $2 THEN e.starts_at END DESC,
			e.id`
	default:
		return nil, ErrInvalidHistoryView
	}

	query := `
		SELECT ` + qualifiedEventColumns + `,
			participant.user_id IS NOT NULL, saved.user_id IS NOT NULL
		FROM events e
		LEFT JOIN event_participants participant
			ON participant.event_id = e.id AND participant.user_id = $1
		LEFT JOIN saved_events saved
			ON saved.event_id = e.id AND saved.user_id = $1
		WHERE ` + condition + `
			` + r.visibleEventsSQL("e.") + `
		ORDER BY ` + order + `
		LIMIT $3`
	rows, err := r.db.QueryContext(ctx, query, userID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("get user event history: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result := []HistoryItem{}
	for rows.Next() {
		item, err := scanHistoryItem(rows)
		if err != nil {
			return nil, fmt.Errorf("scan user event history: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user event history: %w", err)
	}
	return result, nil
}

func (r *PostgresRepository) ProfileEvents(
	ctx context.Context,
	viewerID, targetID, beforeID int64,
	now time.Time,
	limit int,
) ([]HistoryItem, error) {
	var visible bool
	err := r.db.QueryRowContext(ctx, `
		SELECT target.id = $1 OR target.participant_visibility = 'participants' OR EXISTS (
			SELECT 1 FROM friendships friendship
			WHERE friendship.user_low_id = LEAST($1, target.id)
				AND friendship.user_high_id = GREATEST($1, target.id)
		)
		FROM users target
		WHERE target.id = $2 AND target.moderation_suspended_at IS NULL AND NOT EXISTS (
			SELECT 1 FROM user_blocks block
			WHERE (block.blocker_id = $1 AND block.blocked_id = target.id)
				OR (block.blocker_id = target.id AND block.blocked_id = $1)
		)`, viewerID, targetID).Scan(&visible)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("authorize public user events: %w", err)
	}
	if !visible {
		return []HistoryItem{}, nil
	}

	query := `
		SELECT ` + qualifiedEventColumns + `,
			participant.user_id IS NOT NULL, false
		FROM events e
		LEFT JOIN event_participants participant
			ON participant.event_id = e.id AND participant.user_id = $1
		WHERE (participant.user_id IS NOT NULL OR e.created_by_user_id = $1)
			AND COALESCE(e.ends_at, e.starts_at) >= $3
			AND ($2 = 0 OR e.id < $2)
			` + r.visibleEventsSQL("e.") + `
		ORDER BY e.id DESC
		LIMIT $4`
	rows, err := r.db.QueryContext(ctx, query, targetID, beforeID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("get public user events: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]HistoryItem, 0, limit)
	for rows.Next() {
		item, err := scanHistoryItem(rows)
		if err != nil {
			return nil, fmt.Errorf("scan public user event: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate public user events: %w", err)
	}
	return result, nil
}

func scanNearbyEvent(row rowScanner) (NearbyEvent, error) {
	var item NearbyEvent
	err := scanEventFields(row, &item.Event, &item.DistanceMeters)
	return item, err
}

func scanHistoryItem(row rowScanner) (HistoryItem, error) {
	var item HistoryItem
	err := scanEventFields(row, &item.Event, &item.Participating, &item.Saved)
	return item, err
}

func (r *PostgresRepository) Activity(ctx context.Context, userID int64) (Activity, error) {
	var activity Activity
	err := r.db.QueryRowContext(ctx, `
 SELECT
  ARRAY(SELECT e.id FROM event_participants p JOIN events e ON e.id = p.event_id
   WHERE p.user_id = $1 `+r.visibleEventsSQL("e.")+` ORDER BY e.id),
  ARRAY(SELECT e.id FROM saved_events s JOIN events e ON e.id = s.event_id
   WHERE s.user_id = $1 `+r.visibleEventsSQL("e.")+` ORDER BY e.id),
  (SELECT count(*) FROM group_members m JOIN events e ON e.id = m.event_id
   WHERE m.user_id = $1 AND COALESCE(e.ends_at, e.starts_at) >= now()
    `+r.visibleEventsSQL("e.")+`)`, userID).Scan(
		&activity.ParticipatingEventIDs, &activity.SavedEventIDs, &activity.GroupCount,
	)
	if err != nil {
		return Activity{}, fmt.Errorf("get event activity: %w", err)
	}
	return activity, nil
}
