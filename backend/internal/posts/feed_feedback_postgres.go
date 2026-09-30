package posts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

func (r *PostgresRepository) HideFromFeed(ctx context.Context, viewerID, postID int64) error {
	if viewerID <= 0 || postID <= 0 {
		return ErrInvalidPost
	}
	var authorID int64
	err := r.db.QueryRowContext(ctx, `SELECT post.author_user_id FROM posts post
		WHERE post.id=$2 AND `+postVisibleToViewerSQL+`
		AND NOT EXISTS (SELECT 1 FROM user_blocks block WHERE
			(block.blocker_id=$1 AND block.blocked_id=post.author_user_id)
			OR (block.blocker_id=post.author_user_id AND block.blocked_id=$1))`,
		viewerID, postID).Scan(&authorID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("authorize feed feedback: %w", err)
	}
	if authorID == viewerID {
		return ErrInvalidPost
	}
	if _, err := r.db.ExecContext(ctx, `INSERT INTO feed_feedback(user_id,post_id)
		VALUES($1,$2) ON CONFLICT(user_id,post_id) DO NOTHING`, viewerID, postID); err != nil {
		return fmt.Errorf("save feed feedback: %w", err)
	}
	return nil
}
