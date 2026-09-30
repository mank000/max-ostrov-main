package groups

import (
	"context"
	"database/sql"
	"fmt"
)

func requireNoBlockedMembers(ctx context.Context, tx *sql.Tx, userID, groupID int64) error {
	blocked, err := rowExists(ctx, tx, `
		SELECT EXISTS (
			SELECT 1 FROM group_members member JOIN user_blocks block
				ON (block.blocker_id = $1 AND block.blocked_id = member.user_id)
					OR (block.blocker_id = member.user_id AND block.blocked_id = $1)
			WHERE member.group_id = $2
		)`, userID, groupID)
	if err != nil {
		return fmt.Errorf("check group member blocks: %w", err)
	}
	if blocked {
		return ErrBlocked
	}
	return nil
}

func requireMergeUnblocked(ctx context.Context, tx *sql.Tx, sourceID, targetID int64) error {
	blocked, err := rowExists(ctx, tx, `
		SELECT EXISTS (
			SELECT 1 FROM group_members source
			JOIN group_members target ON target.group_id = $2
			JOIN user_blocks block
				ON (block.blocker_id = source.user_id AND block.blocked_id = target.user_id)
					OR (block.blocker_id = target.user_id AND block.blocked_id = source.user_id)
			WHERE source.group_id = $1
		)`, sourceID, targetID)
	if err != nil {
		return fmt.Errorf("check merged group blocks: %w", err)
	}
	if blocked {
		return ErrBlocked
	}
	return nil
}
