package groups

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func lockGroup(ctx context.Context, tx *sql.Tx, groupID int64, now time.Time) (int64, int, JoinPolicy, error) {
	var eventID int64
	var capacity int
	var policy JoinPolicy
	var active bool
	err := tx.QueryRowContext(ctx, `
		SELECT g.event_id, g.capacity, g.join_policy, coalesce(e.ends_at, e.starts_at) >= $2
		FROM event_groups g JOIN events e ON e.id = g.event_id AND e.moderation_hidden_at IS NULL
		WHERE g.id = $1 FOR UPDATE OF g`, groupID, now).Scan(&eventID, &capacity, &policy, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, "", ErrNotFound
	}
	if err != nil {
		return 0, 0, "", fmt.Errorf("lock group: %w", err)
	}
	if !active {
		return 0, 0, "", ErrEventEnded
	}
	return eventID, capacity, policy, nil
}

func ensureCanJoin(ctx context.Context, tx *sql.Tx, userID, eventID, groupID int64, capacity int) error {
	if err := requireNoBlockedMembers(ctx, tx, userID, groupID); err != nil {
		return err
	}
	var existingGroupID sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT max(group_id) FROM group_members WHERE user_id = $1 AND event_id = $2", userID, eventID).Scan(&existingGroupID); err != nil {
		return fmt.Errorf("check group membership: %w", err)
	}
	if existingGroupID.Valid {
		return ErrAlreadyInGroup
	}
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM group_members WHERE group_id = $1", groupID).Scan(&count); err != nil {
		return fmt.Errorf("count group members: %w", err)
	}
	if count >= capacity {
		return ErrGroupFull
	}
	return nil
}

type leaderChecker interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func requireLeader(ctx context.Context, q leaderChecker, userID, groupID int64) error {
	leaderID, err := groupLeader(ctx, q, groupID)
	if err != nil {
		return err
	}
	if leaderID != userID {
		return ErrForbidden
	}
	return nil
}

func groupLeader(ctx context.Context, q leaderChecker, groupID int64) (int64, error) {
	var leaderID int64
	err := q.QueryRowContext(ctx, `SELECT g.leader_user_id FROM event_groups g
		JOIN events e ON e.id=g.event_id AND e.moderation_hidden_at IS NULL
		WHERE g.id=$1`, groupID).Scan(&leaderID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("check group leader: %w", err)
	}
	return leaderID, nil
}

func requireNotBlocked(ctx context.Context, q leaderChecker, firstID, secondID int64) error {
	blocked, err := rowExists(ctx, q, `
		SELECT EXISTS (
			SELECT 1 FROM user_blocks
			WHERE (blocker_id = $1 AND blocked_id = $2)
				OR (blocker_id = $2 AND blocked_id = $1)
		)`, firstID, secondID)
	if err != nil {
		return fmt.Errorf("check group user block: %w", err)
	}
	if blocked {
		return ErrBlocked
	}
	return nil
}

func rowExists(ctx context.Context, q leaderChecker, query string, args ...any) (bool, error) {
	var exists bool
	err := q.QueryRowContext(ctx, query, args...).Scan(&exists)
	return exists, err
}

func scanGroupWithInvitation(row rowScanner) (Invitation, error) {
	var item Invitation
	err := row.Scan(
		&item.Group.ID, &item.Group.EventID, &item.Group.LeaderUserID, &item.Group.Title,
		&item.Group.JoinPolicy, &item.Group.Capacity, &item.Group.ChatProvider, &item.Group.ChatURL,
		&item.Group.MemberCount,
		&item.Group.AvailablePlaces, &item.Group.Joined, &item.Group.IsLeader,
		&item.Group.JoinRequested, &item.Group.Invited, &item.Group.ReinviteRequired,
		&item.Group.CreatedAt, &item.Group.UpdatedAt, &item.CreatedAt,
	)
	return item, err
}

func mapMembershipError(err error, operation string) error {
	if isUniqueViolation(err) {
		return ErrAlreadyInGroup
	}
	if isForeignKeyViolation(err) {
		return ErrNotParticipant
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func commit(tx *sql.Tx, operation string) error {
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit %s: %w", operation, err)
	}
	return nil
}
