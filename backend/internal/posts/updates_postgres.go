package posts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

func (r *PostgresRepository) ListByIDs(ctx context.Context, userID int64, ids []int64) ([]Post, error) {
	return r.list(ctx, `post.id = ANY($1::bigint[]) AND $2::bigint = 0
		AND (post.author_user_id = $4 OR EXISTS (
			SELECT 1 FROM user_identities identity
			WHERE identity.user_id = post.author_user_id AND identity.status = 'verified'
		))`, []any{ids, 0, len(ids), userID}, len(ids))
}

func (r *PostgresRepository) VisibleViewers(ctx context.Context, postID int64, userIDs []int64) ([]int64, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT active.user_id
		FROM unnest($1::bigint[]) AS active(user_id)
		JOIN users viewer ON viewer.id = active.user_id AND viewer.moderation_suspended_at IS NULL
		JOIN posts post ON post.id = $2
		WHERE `+postVisibleToViewerFor("post", "active.user_id")+`
			AND (post.author_user_id = active.user_id OR EXISTS (
				SELECT 1 FROM user_identities identity
				WHERE identity.user_id = post.author_user_id AND identity.status = 'verified'
			))
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = active.user_id AND block.blocked_id = post.author_user_id)
					OR (block.blocker_id = post.author_user_id AND block.blocked_id = active.user_id)
			)`, userIDs, postID)
	if err != nil {
		return nil, fmt.Errorf("load post viewers: %w", err)
	}
	defer func() { _ = rows.Close() }()
	viewers := make([]int64, 0, len(userIDs))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("read post viewer: %w", err)
		}
		viewers = append(viewers, id)
	}
	return viewers, rows.Err()
}

func (r *PostgresRepository) CommentPost(ctx context.Context, userID, commentID int64) (int64, error) {
	var postID int64
	err := r.db.QueryRowContext(ctx, `
		SELECT post.id
		FROM post_comments comment JOIN posts post ON post.id = comment.post_id
		WHERE comment.id = $2 AND comment_safety_visible(comment.id,$1) AND `+postVisibleToViewerSQL+`
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = post.author_user_id)
					OR (block.blocker_id = post.author_user_id AND block.blocked_id = $1)
			)`, userID, commentID).Scan(&postID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("load comment post: %w", err)
	}
	return postID, nil
}

func (r *PostgresRepository) CommentsByIDs(ctx context.Context, userID, postID int64, ids []int64) ([]Comment, error) {
	return r.listComments(ctx, userID, postID, 0, len(ids), ids)
}
