package groups

import (
	"context"
	"fmt"
	"time"
)

func (r *PostgresRepository) RequestJoin(ctx context.Context, userID, groupID int64, now time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin join request: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	eventID, capacity, policy, err := lockGroup(ctx, tx, groupID, now)
	if err != nil {
		return err
	}
	if policy != PolicyRequest {
		return ErrInvalidGroup
	}
	if err := requireActiveParticipant(ctx, tx, userID, eventID, now); err != nil {
		return err
	}
	removed, err := rowExists(ctx, tx, "SELECT EXISTS (SELECT 1 FROM group_removed_members WHERE group_id = $1 AND user_id = $2)", groupID, userID)
	if err != nil {
		return fmt.Errorf("check group removal before request: %w", err)
	}
	if removed {
		return ErrInvitationNeeded
	}
	leaderID, err := groupLeader(ctx, tx, groupID)
	if err != nil {
		return err
	}
	if err := requireNotBlocked(ctx, tx, userID, leaderID); err != nil {
		return err
	}
	if err := ensureCanJoin(ctx, tx, userID, eventID, groupID, capacity); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO group_join_requests (group_id, user_id, created_at)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, groupID, userID, now,
	); err != nil {
		return fmt.Errorf("create join request: %w", err)
	}
	return commit(tx, "join request")
}

func (r *PostgresRepository) ListRequests(ctx context.Context, leaderID, groupID int64) ([]Candidate, error) {
	if err := requireLeader(ctx, r.db, leaderID, groupID); err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT r.group_id, r.user_id, u.display_name,
			CASE WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content' END,
			r.created_at
		FROM group_join_requests r
		JOIN users u ON u.id = r.user_id
		WHERE r.group_id = $1
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $2 AND block.blocked_id = r.user_id)
					OR (block.blocker_id = r.user_id AND block.blocked_id = $2)
			)
		ORDER BY r.created_at, r.user_id`, groupID, leaderID)
	if err != nil {
		return nil, fmt.Errorf("list join requests: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []Candidate{}
	for rows.Next() {
		var item Candidate
		if err := rows.Scan(&item.GroupID, &item.UserID, &item.DisplayName, &item.PhotoURL, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan join request: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) ResolveRequest(ctx context.Context, leaderID, groupID, userID int64, accept bool, now time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin join request resolution: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	eventID, capacity, _, err := lockGroup(ctx, tx, groupID, now)
	if err != nil {
		return err
	}
	if err := requireLeader(ctx, tx, leaderID, groupID); err != nil {
		return err
	}
	exists, err := rowExists(ctx, tx, "SELECT EXISTS (SELECT 1 FROM group_join_requests WHERE group_id = $1 AND user_id = $2)", groupID, userID)
	if err != nil {
		return fmt.Errorf("find join request: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	if accept {
		removed, err := rowExists(ctx, tx, "SELECT EXISTS (SELECT 1 FROM group_removed_members WHERE group_id = $1 AND user_id = $2)", groupID, userID)
		if err != nil {
			return fmt.Errorf("check group removal before accepting request: %w", err)
		}
		if removed {
			return ErrInvitationNeeded
		}
		if err := requireNotBlocked(ctx, tx, userID, leaderID); err != nil {
			return err
		}
		if err := requireActiveParticipant(ctx, tx, userID, eventID, now); err != nil {
			return err
		}
		if err := ensureCanJoin(ctx, tx, userID, eventID, groupID, capacity); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO group_members (group_id, event_id, user_id) VALUES ($1, $2, $3)", groupID, eventID, userID); err != nil {
			return mapMembershipError(err, "accept join request")
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM group_invitations WHERE user_id = $2 AND group_id IN (SELECT id FROM event_groups WHERE event_id = $1)", eventID, userID); err != nil {
			return fmt.Errorf("delete obsolete invitation: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_join_requests WHERE user_id = $2
		AND (group_id = $1 OR ($3 AND group_id IN (SELECT id FROM event_groups WHERE event_id = $4)))`, groupID, userID, accept, eventID); err != nil {
		return fmt.Errorf("delete join request: %w", err)
	}
	return commit(tx, "join request resolution")
}

func (r *PostgresRepository) Invite(ctx context.Context, leaderID, groupID, userID int64, now time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group invitation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	eventID, capacity, _, err := lockGroup(ctx, tx, groupID, now)
	if err != nil {
		return err
	}
	if err := requireLeader(ctx, tx, leaderID, groupID); err != nil {
		return err
	}
	if err := requireNotBlocked(ctx, tx, leaderID, userID); err != nil {
		return err
	}
	if err := requireActiveParticipant(ctx, tx, userID, eventID, now); err != nil {
		return err
	}
	if err := ensureCanJoin(ctx, tx, userID, eventID, groupID, capacity); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO group_invitations (group_id, user_id, invited_by_user_id, created_at)
		VALUES ($1, $2, $3, $4) ON CONFLICT (group_id, user_id) DO NOTHING`, groupID, userID, leaderID, now,
	)
	if err != nil {
		return fmt.Errorf("create group invitation: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read group invitation result: %w", err)
	}
	if inserted > 0 {
		var groupTitle string
		if err := tx.QueryRowContext(ctx, "SELECT title FROM event_groups WHERE id = $1", groupID).Scan(&groupTitle); err != nil {
			return fmt.Errorf("read invited group title: %w", err)
		}
		dedupeKey := fmt.Sprintf("group-invitation:%d:%d:%d", groupID, userID, now.UnixNano())
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO background_jobs (kind, payload, dedupe_key, run_at)
			VALUES ('notification', jsonb_build_object(
				'user_id', $1::bigint,
				'kind', 'group_invitation',
				'title', 'Приглашение в группу',
				'body', $2::text,
				'event_id', $3::bigint,
				'group_id', $4::bigint,
				'actor_user_id', $5::bigint,
				'dedupe_key', $6::text
			), $6, $7)`,
			userID, fmt.Sprintf("Вас пригласили в «%s».", groupTitle), eventID, groupID, leaderID, dedupeKey, now,
		); err != nil {
			return fmt.Errorf("queue group invitation notification: %w", err)
		}
	}
	return commit(tx, "group invitation")
}

func (r *PostgresRepository) ListInvitations(ctx context.Context, userID int64, now time.Time) ([]Invitation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT g.id, g.event_id, g.leader_user_id, g.title, g.join_policy, g.capacity,
			''::text, ''::text,
			count(m.user_id)::int, (g.capacity - count(m.user_id))::int,
			false, false,
			EXISTS (SELECT 1 FROM group_join_requests request WHERE request.group_id = g.id AND request.user_id = $1),
			true,
			EXISTS (SELECT 1 FROM group_removed_members removed WHERE removed.group_id = g.id AND removed.user_id = $1),
			g.created_at, g.updated_at, i.created_at
		FROM group_invitations i
		JOIN event_groups g ON g.id = i.group_id
		JOIN events e ON e.id = g.event_id AND e.moderation_hidden_at IS NULL
		LEFT JOIN group_members m ON m.group_id = g.id
		WHERE i.user_id = $1 AND coalesce(e.ends_at, e.starts_at) >= $2
			AND NOT EXISTS (SELECT 1 FROM group_members own WHERE own.event_id = g.event_id AND own.user_id = $1)
			AND NOT EXISTS (
				SELECT 1 FROM group_members member JOIN user_blocks block
					ON (block.blocker_id = $1 AND block.blocked_id = member.user_id)
						OR (block.blocker_id = member.user_id AND block.blocked_id = $1)
				WHERE member.group_id = g.id
			)
		GROUP BY g.id, i.created_at ORDER BY i.created_at, g.id`, userID, now)
	if err != nil {
		return nil, fmt.Errorf("list group invitations: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []Invitation{}
	for rows.Next() {
		group, err := scanGroupWithInvitation(rows)
		if err != nil {
			return nil, fmt.Errorf("scan group invitation: %w", err)
		}
		items = append(items, group)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) ResolveInvitation(ctx context.Context, userID, groupID int64, accept bool, now time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin invitation resolution: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	eventID, capacity, _, err := lockGroup(ctx, tx, groupID, now)
	if err != nil {
		return err
	}
	exists, err := rowExists(ctx, tx, "SELECT EXISTS (SELECT 1 FROM group_invitations WHERE group_id = $1 AND user_id = $2)", groupID, userID)
	if err != nil {
		return fmt.Errorf("find group invitation: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	if accept {
		leaderID, err := groupLeader(ctx, tx, groupID)
		if err != nil {
			return err
		}
		if err := requireNotBlocked(ctx, tx, userID, leaderID); err != nil {
			return err
		}
		if err := requireActiveParticipant(ctx, tx, userID, eventID, now); err != nil {
			return err
		}
		if err := ensureCanJoin(ctx, tx, userID, eventID, groupID, capacity); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO group_members (group_id, event_id, user_id) VALUES ($1, $2, $3)", groupID, eventID, userID); err != nil {
			return mapMembershipError(err, "accept group invitation")
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM group_join_requests WHERE user_id = $2 AND group_id IN (SELECT id FROM event_groups WHERE event_id = $1)", eventID, userID); err != nil {
			return fmt.Errorf("delete obsolete join request: %w", err)
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM group_removed_members WHERE group_id = $1 AND user_id = $2", groupID, userID); err != nil {
			return fmt.Errorf("clear group removal after invitation: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM group_invitations WHERE user_id = $2
		AND (group_id = $1 OR ($3 AND group_id IN (SELECT id FROM event_groups WHERE event_id = $4)))`, groupID, userID, accept, eventID); err != nil {
		return fmt.Errorf("delete group invitation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE notifications
		SET read_at = COALESCE(read_at, $3)
		WHERE user_id = $2 AND group_id = $1 AND kind = 'group_invitation' AND read_at IS NULL`,
		groupID, userID, now,
	); err != nil {
		return fmt.Errorf("mark group invitation notification read: %w", err)
	}
	return commit(tx, "invitation resolution")
}
