package groups

import (
	"context"
	"fmt"
	"time"
)

func (r *PostgresRepository) Update(
	ctx context.Context,
	leaderID, groupID int64,
	input UpdateInput,
	now time.Time,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, _, _, err := lockGroup(ctx, tx, groupID, now); err != nil {
		return err
	}
	if err := requireLeader(ctx, tx, leaderID, groupID); err != nil {
		return err
	}

	var memberCount int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM group_members WHERE group_id = $1", groupID).Scan(&memberCount); err != nil {
		return fmt.Errorf("count group members before update: %w", err)
	}
	if input.Capacity < memberCount {
		return ErrCapacityTooSmall
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE event_groups
		SET title = $2, capacity = $3, join_policy = $4,
			chat_provider = NULLIF($5, ''), chat_url = NULLIF($6, ''), updated_at = $7
		WHERE id = $1
	`, groupID, input.Title, input.Capacity, input.JoinPolicy, input.ChatProvider, input.ChatURL, now); err != nil {
		return fmt.Errorf("update group: %w", err)
	}
	if input.JoinPolicy != PolicyRequest {
		if _, err := tx.ExecContext(ctx, "DELETE FROM group_join_requests WHERE group_id = $1", groupID); err != nil {
			return fmt.Errorf("clear obsolete group join requests: %w", err)
		}
	}
	return commit(tx, "group update")
}

func (r *PostgresRepository) RemoveMember(
	ctx context.Context,
	leaderID, groupID, userID int64,
	now time.Time,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group member removal: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, _, _, err := lockGroup(ctx, tx, groupID, now); err != nil {
		return err
	}
	if err := requireLeader(ctx, tx, leaderID, groupID); err != nil {
		return err
	}
	if userID == leaderID {
		return ErrCannotRemoveLeader
	}
	exists, err := rowExists(ctx, tx, "SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)", groupID, userID)
	if err != nil {
		return fmt.Errorf("find group member: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO group_removed_members (group_id, user_id, removed_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (group_id, user_id) DO UPDATE SET removed_at = EXCLUDED.removed_at`, groupID, userID, now); err != nil {
		return fmt.Errorf("record removed group member: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID); err != nil {
		return fmt.Errorf("remove group member: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM group_join_requests WHERE group_id = $1 AND user_id = $2", groupID, userID); err != nil {
		return fmt.Errorf("clear removed member join request: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM group_invitations WHERE group_id = $1 AND user_id = $2", groupID, userID); err != nil {
		return fmt.Errorf("clear removed member invitation: %w", err)
	}
	return commit(tx, "group member removal")
}

func (r *PostgresRepository) TransferLeadership(
	ctx context.Context,
	leaderID, groupID, userID int64,
	now time.Time,
) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group leadership transfer: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, _, _, err := lockGroup(ctx, tx, groupID, now); err != nil {
		return err
	}
	if err := requireLeader(ctx, tx, leaderID, groupID); err != nil {
		return err
	}
	if userID == leaderID {
		return commit(tx, "group leadership transfer")
	}
	exists, err := rowExists(ctx, tx, "SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)", groupID, userID)
	if err != nil {
		return fmt.Errorf("find new group leader: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM group_merge_requests WHERE source_group_id = $1", groupID); err != nil {
		return fmt.Errorf("cancel merge requests before leadership transfer: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE event_groups SET leader_user_id = $2, updated_at = $3 WHERE id = $1
	`, groupID, userID, now); err != nil {
		return fmt.Errorf("transfer group leadership: %w", err)
	}
	return commit(tx, "group leadership transfer")
}

func (r *PostgresRepository) ListMembers(ctx context.Context, userID, groupID int64) ([]Member, error) {
	if _, err := groupLeader(ctx, r.db, groupID); err != nil {
		return nil, err
	}
	joined, err := rowExists(ctx, r.db,
		"SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)",
		groupID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("check group member access: %w", err)
	}
	if !joined {
		return nil, ErrForbidden
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT u.id, coalesce(u.username, ''), u.display_name,
			coalesce(CASE WHEN u.avatar_media_id IS NULL
				THEN u.provider_photo_url
				ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content'
			END, ''),
			m.user_id = g.leader_user_id,
			m.joined_at
		FROM group_members m
		JOIN event_groups g ON g.id = m.group_id
		JOIN users u ON u.id = m.user_id
		WHERE m.group_id = $1
		ORDER BY (m.user_id = g.leader_user_id) DESC, m.joined_at, m.user_id
	`, groupID)
	if err != nil {
		return nil, fmt.Errorf("list group members: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items := []Member{}
	for rows.Next() {
		var item Member
		if err := rows.Scan(&item.ID, &item.Username, &item.DisplayName, &item.PhotoURL, &item.IsLeader, &item.JoinedAt); err != nil {
			return nil, fmt.Errorf("scan group member: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate group members: %w", err)
	}
	return items, nil
}
