package social

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

func (r *PostgresRepository) SetFollowing(ctx context.Context, viewer, target int64, following bool) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Follow and block mutations use the same user locks, so a concurrent block wins.
	if err := lockUsers(ctx, tx, viewer, target); err != nil {
		return err
	}
	if !following {
		if _, err := tx.ExecContext(ctx, `DELETE FROM user_follows WHERE follower_id=$1 AND followed_id=$2`, viewer, target); err != nil {
			return err
		}
		return tx.Commit()
	}
	blocked, err := usersBlocked(ctx, tx, viewer, target)
	if err != nil {
		return err
	}
	if blocked {
		return ErrBlocked
	}
	var available bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users u JOIN user_identities identity ON identity.user_id=u.id WHERE u.id=$1 AND u.moderation_suspended_at IS NULL AND identity.status='verified')`, target).Scan(&available); err != nil {
		return err
	}
	if !available {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO user_follows(follower_id,followed_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, viewer, target); err != nil {
		return fmt.Errorf("follow user: %w", err)
	}
	return tx.Commit()
}

type FollowState struct {
	Following      bool `json:"following"`
	Followers      int  `json:"followers"`
	FollowingCount int  `json:"following_count"`
}

func (r *PostgresRepository) FollowState(ctx context.Context, viewer, target int64) (FollowState, error) {
	var state FollowState
	err := r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND followed_id=$2),
 (SELECT count(*) FROM user_follows WHERE followed_id=$2), (SELECT count(*) FROM user_follows WHERE follower_id=$2)
 FROM users WHERE id=$2 AND moderation_suspended_at IS NULL
 AND EXISTS(SELECT 1 FROM user_identities identity WHERE identity.user_id=$2 AND identity.status='verified')
 AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocked_id=$1 AND blocker_id=$2))`, viewer, target).Scan(&state.Following, &state.Followers, &state.FollowingCount)
	if errors.Is(err, sql.ErrNoRows) {
		return state, ErrNotFound
	}
	return state, err
}
func (s *Service) FollowState(ctx context.Context, viewer, target int64) (FollowState, error) {
	return s.repository.FollowState(ctx, viewer, target)
}
