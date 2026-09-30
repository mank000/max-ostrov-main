package groups

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type mergeGroup struct {
	eventID  int64
	count    int
	capacity int
}

type mergePair struct {
	source mergeGroup
	target mergeGroup
}

func lockMergeGroups(ctx context.Context, tx *sql.Tx, sourceID, targetID int64, now time.Time) (mergePair, error) {
	if sourceID == targetID {
		return mergePair{}, ErrInvalidMerge
	}
	first, second := sourceID, targetID
	if first > second {
		first, second = second, first
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM event_groups WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`, first, second)
	if err != nil {
		return mergePair{}, fmt.Errorf("lock merge groups: %w", err)
	}
	locked := 0
	for rows.Next() {
		locked++
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return mergePair{}, fmt.Errorf("iterate locked merge groups: %w", err)
	}
	if err := rows.Close(); err != nil {
		return mergePair{}, fmt.Errorf("close locked merge groups: %w", err)
	}
	if locked != 2 {
		return mergePair{}, ErrNotFound
	}

	rows, err = tx.QueryContext(ctx, `
		SELECT g.id, g.event_id, g.capacity, count(m.user_id)::int,
			coalesce(e.ends_at, e.starts_at) >= $3
		FROM event_groups g JOIN events e ON e.id = g.event_id AND e.moderation_hidden_at IS NULL
		LEFT JOIN group_members m ON m.group_id = g.id
		WHERE g.id IN ($1, $2) GROUP BY g.id, e.id ORDER BY g.id`, first, second, now)
	if err != nil {
		return mergePair{}, fmt.Errorf("read merge groups: %w", err)
	}
	defer func() { _ = rows.Close() }()
	type state struct {
		eventID         int64
		capacity, count int
		active          bool
	}
	states := map[int64]state{}
	for rows.Next() {
		var id int64
		var value state
		if err := rows.Scan(&id, &value.eventID, &value.capacity, &value.count, &value.active); err != nil {
			return mergePair{}, fmt.Errorf("scan merge group: %w", err)
		}
		states[id] = value
	}
	if err := rows.Err(); err != nil {
		return mergePair{}, fmt.Errorf("iterate merge groups: %w", err)
	}
	source, target := states[sourceID], states[targetID]
	if !source.active || !target.active {
		return mergePair{}, ErrEventEnded
	}
	return mergePair{source: mergeGroup{source.eventID, source.count, source.capacity}, target: mergeGroup{target.eventID, target.count, target.capacity}}, nil
}
