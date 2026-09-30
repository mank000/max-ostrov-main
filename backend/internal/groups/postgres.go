package groups

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) Create(
	ctx context.Context,
	userID, eventID int64,
	input CreateInput,
	now time.Time,
) (Group, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Group{}, fmt.Errorf("begin group creation: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := requireActiveParticipant(ctx, tx, userID, eventID, now); err != nil {
		return Group{}, err
	}

	var group Group
	err = tx.QueryRowContext(ctx, `
		INSERT INTO
		    event_groups (
		        event_id,
		        leader_user_id,
		        created_by_user_id,
		        title,
		        capacity,
		        join_policy,
		        chat_provider,
		        chat_url,
		        idempotency_key,
		        idempotency_hash
		    )
		VALUES
		    ($1, $2, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8, $9)
		ON CONFLICT (created_by_user_id, event_id, idempotency_key)
		WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING id,
		    event_id,
		    leader_user_id,
		    title,
		    join_policy,
		    capacity,
		    coalesce(chat_provider, ''),
		    coalesce(chat_url, ''),
		    created_at,
		    updated_at
	`,
		eventID, userID, input.Title, input.Capacity, input.JoinPolicy,
		input.ChatProvider, input.ChatURL, input.IdempotencyKey, input.IdempotencyHash,
	).Scan(
		&group.ID, &group.EventID, &group.LeaderUserID, &group.Title,
		&group.JoinPolicy, &group.Capacity, &group.ChatProvider, &group.ChatURL,
		&group.CreatedAt, &group.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		var storedHash []byte
		err = tx.QueryRowContext(ctx, `
			SELECT
			    g.id,
			    g.event_id,
			    g.leader_user_id,
			    g.title,
			    g.join_policy,
			    g.capacity,
			    coalesce(g.chat_provider, ''),
			    coalesce(g.chat_url, ''),
			    count(m.user_id)::int,
			    (g.capacity - count(m.user_id))::int,
			    coalesce(bool_or(m.user_id = $1), false),
			    g.leader_user_id = $1,
			    EXISTS (
			        SELECT
			            1
			        FROM group_join_requests request
			        WHERE request.group_id = g.id
			            AND request.user_id = $1
			    ),
			    EXISTS (
			        SELECT
			            1
			        FROM group_invitations invitation
			        WHERE invitation.group_id = g.id
			            AND invitation.user_id = $1
			    ),
			    g.created_at,
			    g.updated_at,
			    g.idempotency_hash
			FROM event_groups g
			    LEFT JOIN group_members m ON m.group_id = g.id
			WHERE g.created_by_user_id = $1
			    AND g.event_id = $2
			    AND g.idempotency_key = $3
			GROUP BY
			    g.id
		`, userID, eventID, input.IdempotencyKey,
		).Scan(
			&group.ID, &group.EventID, &group.LeaderUserID, &group.Title, &group.JoinPolicy,
			&group.Capacity, &group.ChatProvider, &group.ChatURL,
			&group.MemberCount, &group.AvailablePlaces, &group.Joined,
			&group.IsLeader, &group.JoinRequested, &group.Invited,
			&group.CreatedAt, &group.UpdatedAt, &storedHash,
		)
		if err != nil {
			return Group{}, fmt.Errorf("get idempotent group: %w", err)
		}
		if !bytes.Equal(storedHash, input.IdempotencyHash) {
			return Group{}, ErrIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
			return Group{}, fmt.Errorf("commit idempotent group creation: %w", err)
		}
		return group, nil
	}
	if err != nil {
		return Group{}, fmt.Errorf("create group: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO
		    group_members (group_id, event_id, user_id)
		VALUES
		    ($1, $2, $3)
	`, group.ID, eventID, userID,
	); err != nil {
		if isUniqueViolation(err) {
			return Group{}, ErrAlreadyInGroup
		}
		if isForeignKeyViolation(err) {
			return Group{}, ErrNotParticipant
		}
		return Group{}, fmt.Errorf("add group leader: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM group_join_requests
		WHERE user_id = $1
		    AND group_id IN (
		        SELECT
		            id
		        FROM event_groups
		        WHERE event_id = $2
		    )
	`, userID, eventID); err != nil {
		return Group{}, fmt.Errorf("clear group creator requests: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM group_invitations
		WHERE user_id = $1
		    AND group_id IN (
		        SELECT
		            id
		        FROM event_groups
		        WHERE event_id = $2
		    )
	`, userID, eventID); err != nil {
		return Group{}, fmt.Errorf("clear group creator invitations: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Group{}, fmt.Errorf("commit group creation: %w", err)
	}

	group.MemberCount = 1
	group.AvailablePlaces = group.Capacity - 1
	group.Joined = true
	group.IsLeader = true
	return group, nil
}

func (r *PostgresRepository) List(
	ctx context.Context,
	userID, eventID int64,
	now time.Time,
) ([]Group, error) {
	if err := requireActiveParticipant(ctx, r.db, userID, eventID, now); err != nil {
		return nil, err
	}

	rows, err := r.db.QueryContext(ctx, listSQL, userID, eventID)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	result := []Group{}
	for rows.Next() {
		group, err := scanGroup(rows)
		if err != nil {
			return nil, fmt.Errorf("scan group: %w", err)
		}
		result = append(result, group)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate groups: %w", err)
	}
	return result, nil
}

func (r *PostgresRepository) Join(ctx context.Context, userID, groupID int64, now time.Time) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group join: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var eventID int64
	var leaderID int64
	var capacity int
	var active bool
	var policy JoinPolicy
	err = tx.QueryRowContext(ctx, `
		SELECT
		    g.event_id,
		    g.leader_user_id,
		    g.capacity,
		    g.join_policy,
		    coalesce(e.ends_at, e.starts_at) >= $2
		FROM event_groups g
		    JOIN events e ON e.id = g.event_id
		    AND e.moderation_hidden_at IS NULL
		WHERE g.id = $1
		FOR UPDATE OF
		    g
	`, groupID, now,
	).Scan(&eventID, &leaderID, &capacity, &policy, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("lock group: %w", err)
	}
	if !active {
		return ErrEventEnded
	}

	var participant bool
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM event_participants
		        WHERE user_id = $1
		            AND event_id = $2
		    )
	`, userID, eventID,
	).Scan(&participant); err != nil {
		return fmt.Errorf("check event participation: %w", err)
	}
	if !participant {
		return ErrNotParticipant
	}
	if err := requireNotBlocked(ctx, tx, userID, leaderID); err != nil {
		return err
	}
	if err := requireNoBlockedMembers(ctx, tx, userID, groupID); err != nil {
		return err
	}

	var existingGroupID sql.NullInt64
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    max(group_id)
		FROM group_members
		WHERE user_id = $1
		    AND event_id = $2
	`,
		userID, eventID,
	).Scan(&existingGroupID); err != nil {
		return fmt.Errorf("check group membership: %w", err)
	}
	if existingGroupID.Valid {
		if existingGroupID.Int64 == groupID {
			return tx.Commit()
		}
		return ErrAlreadyInGroup
	}
	var reinviteRequired bool
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM group_removed_members
		        WHERE group_id = $1
		            AND user_id = $2
		    )
	`,
		groupID, userID,
	).Scan(&reinviteRequired); err != nil {
		return fmt.Errorf("check group removal: %w", err)
	}
	if policy != PolicyOpen || reinviteRequired {
		var invited bool
		if err := tx.QueryRowContext(ctx, `
			SELECT
			    EXISTS (
			        SELECT
			            1
			        FROM group_invitations
			        WHERE group_id = $1
			            AND user_id = $2
			    )
		`,
			groupID, userID,
		).Scan(&invited); err != nil {
			return fmt.Errorf("check group invitation: %w", err)
		}
		if !invited {
			if reinviteRequired {
				return ErrInvitationNeeded
			}
			if policy == PolicyRequest {
				return ErrRequestRequired
			}
			return ErrInvitationNeeded
		}
	}

	var memberCount int
	if err := tx.QueryRowContext(ctx,
		"SELECT count(*) FROM group_members WHERE group_id = $1", groupID,
	).Scan(&memberCount); err != nil {
		return fmt.Errorf("count group members: %w", err)
	}
	if memberCount >= capacity {
		return ErrGroupFull
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO
		    group_members (group_id, event_id, user_id)
		VALUES
		    ($1, $2, $3)
	`, groupID, eventID, userID,
	); err != nil {
		if isUniqueViolation(err) {
			return ErrAlreadyInGroup
		}
		if isForeignKeyViolation(err) {
			return ErrNotParticipant
		}
		return fmt.Errorf("join group: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM group_invitations WHERE user_id = $2 AND group_id IN (SELECT id FROM event_groups WHERE event_id = $1)", eventID, userID,
	); err != nil {
		return fmt.Errorf("consume group invitation: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM group_join_requests WHERE user_id = $2 AND group_id IN (SELECT id FROM event_groups WHERE event_id = $1)", eventID, userID,
	); err != nil {
		return fmt.Errorf("consume join request: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE notifications
		SET read_at = COALESCE(read_at, $3)
		WHERE user_id = $2
		    AND group_id = $1
		    AND kind = 'group_invitation'
		    AND read_at IS NULL
	`,
		groupID, userID, now,
	); err != nil {
		return fmt.Errorf("mark consumed group invitation notification read: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM group_removed_members WHERE group_id = $1 AND user_id = $2", groupID, userID); err != nil {
		return fmt.Errorf("clear group removal after invitation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit group join: %w", err)
	}
	return nil
}

func (r *PostgresRepository) Leave(ctx context.Context, userID, groupID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin group leave: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var leaderUserID int64
	err = tx.QueryRowContext(ctx,
		"SELECT leader_user_id FROM event_groups WHERE id = $1 FOR UPDATE", groupID,
	).Scan(&leaderUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return tx.Commit()
	}
	if err != nil {
		return fmt.Errorf("lock group for leave: %w", err)
	}

	var member bool
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM group_members
		        WHERE group_id = $1
		            AND user_id = $2
		    )
	`,
		groupID, userID,
	).Scan(&member); err != nil {
		return fmt.Errorf("check membership before leave: %w", err)
	}
	if !member {
		return tx.Commit()
	}

	if leaderUserID == userID {
		var nextLeaderID int64
		err := tx.QueryRowContext(ctx, `
			SELECT
			    user_id
			FROM group_members
			WHERE group_id = $1
			    AND user_id <> $2
			ORDER BY
			    joined_at,
			    user_id
			LIMIT 1
		`, groupID, userID,
		).Scan(&nextLeaderID)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			if _, err := tx.ExecContext(ctx, "DELETE FROM event_groups WHERE id = $1", groupID); err != nil {
				return fmt.Errorf("delete empty group: %w", err)
			}
		case err != nil:
			return fmt.Errorf("select next group leader: %w", err)
		default:
			if _, err := tx.ExecContext(ctx, "DELETE FROM group_merge_requests WHERE source_group_id = $1", groupID); err != nil {
				return fmt.Errorf("cancel former leader merge request: %w", err)
			}
			if _, err := tx.ExecContext(ctx,
				"UPDATE event_groups SET leader_user_id = $2, updated_at = now() WHERE id = $1",
				groupID, nextLeaderID,
			); err != nil {
				return fmt.Errorf("transfer group leadership: %w", err)
			}
			if _, err := tx.ExecContext(ctx,
				"DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID,
			); err != nil {
				return fmt.Errorf("remove former group leader: %w", err)
			}
		}
	} else if _, err := tx.ExecContext(ctx,
		"DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID,
	); err != nil {
		return fmt.Errorf("leave group: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit group leave: %w", err)
	}
	return nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanGroup(row rowScanner) (Group, error) {
	var group Group
	err := row.Scan(
		&group.ID, &group.EventID, &group.LeaderUserID, &group.Title, &group.JoinPolicy, &group.Capacity,
		&group.ChatProvider, &group.ChatURL, &group.MemberCount, &group.AvailablePlaces, &group.Joined, &group.IsLeader,
		&group.JoinRequested, &group.Invited, &group.ReinviteRequired, &group.CreatedAt, &group.UpdatedAt,
	)
	return group, err
}

type queryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func requireActiveParticipant(
	ctx context.Context,
	q queryRower,
	userID, eventID int64,
	now time.Time,
) error {
	var active, participant bool
	err := q.QueryRowContext(ctx, `
		SELECT
		    coalesce(ends_at, starts_at) >= $3,
		    EXISTS (
		        SELECT
		            1
		        FROM event_participants
		        WHERE user_id = $1
		            AND event_id = $2
		    )
		FROM events
		WHERE id = $2
		    AND moderation_hidden_at IS NULL
	`, userID, eventID, now,
	).Scan(&active, &participant)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("check event group access: %w", err)
	}
	if !active {
		return ErrEventEnded
	}
	if !participant {
		return ErrNotParticipant
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505"
}

func isForeignKeyViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23503"
}
