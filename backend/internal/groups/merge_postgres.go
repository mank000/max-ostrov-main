package groups

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func (r *PostgresRepository) RequestMerge(ctx context.Context, leaderID, sourceGroupID, targetGroupID int64, now time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin merge request: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	pair, err := lockMergeGroups(ctx, tx, sourceGroupID, targetGroupID, now)
	if err != nil {
		return err
	}
	if pair.source.eventID != pair.target.eventID || pair.source.count+pair.target.count > pair.target.capacity {
		return ErrInvalidMerge
	}
	if err := requireLeader(ctx, tx, leaderID, sourceGroupID); err != nil {
		return err
	}
	if err := requireMergeUnblocked(ctx, tx, sourceGroupID, targetGroupID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO group_merge_requests (source_group_id, target_group_id, requested_by_user_id, created_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (source_group_id) DO UPDATE SET target_group_id = EXCLUDED.target_group_id,
			requested_by_user_id = EXCLUDED.requested_by_user_id, created_at = EXCLUDED.created_at`,
		sourceGroupID, targetGroupID, leaderID, now,
	); err != nil {
		return fmt.Errorf("create merge request: %w", err)
	}
	return commit(tx, "merge request")
}

func (r *PostgresRepository) ListMergeRequests(ctx context.Context, leaderID, targetGroupID int64, now time.Time) ([]MergeRequest, error) {
	if err := requireLeader(ctx, r.db, leaderID, targetGroupID); err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT g.id, g.event_id, g.leader_user_id, g.title, g.join_policy, g.capacity,
			''::text, ''::text,
			count(m.user_id)::int, (g.capacity - count(m.user_id))::int,
			false, false, false, false, false, g.created_at, g.updated_at, r.created_at
		FROM group_merge_requests r
		JOIN event_groups g ON g.id = r.source_group_id
		JOIN events e ON e.id = g.event_id AND e.moderation_hidden_at IS NULL
		LEFT JOIN group_members m ON m.group_id = g.id
		WHERE r.target_group_id = $1 AND r.requested_by_user_id = g.leader_user_id
			AND coalesce(e.ends_at, e.starts_at) >= $2
		GROUP BY g.id, r.created_at ORDER BY r.created_at, g.id`, targetGroupID, now)
	if err != nil {
		return nil, fmt.Errorf("list merge requests: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []MergeRequest{}
	for rows.Next() {
		var item MergeRequest
		if err := rows.Scan(
			&item.SourceGroup.ID, &item.SourceGroup.EventID, &item.SourceGroup.LeaderUserID,
			&item.SourceGroup.Title, &item.SourceGroup.JoinPolicy, &item.SourceGroup.Capacity,
			&item.SourceGroup.ChatProvider, &item.SourceGroup.ChatURL,
			&item.SourceGroup.MemberCount, &item.SourceGroup.AvailablePlaces,
			&item.SourceGroup.Joined, &item.SourceGroup.IsLeader,
			&item.SourceGroup.JoinRequested, &item.SourceGroup.Invited, &item.SourceGroup.ReinviteRequired,
			&item.SourceGroup.CreatedAt, &item.SourceGroup.UpdatedAt, &item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan merge request: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) ResolveMerge(ctx context.Context, leaderID, targetGroupID, sourceGroupID int64, accept bool, now time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin merge resolution: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	pair, err := lockMergeGroups(ctx, tx, sourceGroupID, targetGroupID, now)
	if err != nil {
		return err
	}
	if err := requireLeader(ctx, tx, leaderID, targetGroupID); err != nil {
		return err
	}
	var requesterID int64
	err = tx.QueryRowContext(ctx, `
		SELECT requested_by_user_id FROM group_merge_requests
		WHERE source_group_id = $1 AND target_group_id = $2`, sourceGroupID, targetGroupID).Scan(&requesterID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("find merge request: %w", err)
	}
	if err := requireLeader(ctx, tx, requesterID, sourceGroupID); err != nil {
		return ErrInvalidMerge
	}
	if accept {
		if err := requireMergeUnblocked(ctx, tx, sourceGroupID, targetGroupID); err != nil {
			return err
		}
		if pair.source.eventID != pair.target.eventID || pair.source.count+pair.target.count > pair.target.capacity {
			return ErrInvalidMerge
		}
		if _, err := tx.ExecContext(ctx, "UPDATE group_members SET group_id = $1 WHERE group_id = $2", targetGroupID, sourceGroupID); err != nil {
			return fmt.Errorf("move merged group members: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM event_groups WHERE id = $1", sourceGroupID); err != nil {
			return fmt.Errorf("delete merged group: %w", err)
		}
	} else if _, err := tx.ExecContext(ctx, "DELETE FROM group_merge_requests WHERE source_group_id = $1", sourceGroupID); err != nil {
		return fmt.Errorf("reject merge request: %w", err)
	}
	return commit(tx, "merge resolution")
}
