package posts

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
)

const rankedCommentSnapshotSize = 5000

//go:embed ranked_comments.sql
var rankedCommentsSQL string

func (r *PostgresRepository) RankedComments(ctx context.Context, viewerID, postID int64, cursor string, limit int) ([]Comment, *string, error) {
	if viewerID <= 0 || postID <= 0 || limit <= 0 || limit > 50 {
		return nil, nil, ErrInvalidComment
	}
	var snapshotID string
	position := 0
	if cursor == "" {

		if _, err := r.ListComments(ctx, viewerID, postID, 0, 1); err != nil {
			return nil, nil, err
		}
		var err error
		snapshotID, err = r.createRankedCommentSnapshot(ctx, viewerID, postID)
		if err != nil {
			return nil, nil, err
		}
	} else {
		var err error
		snapshotID, position, err = parseRankCursor(cursor, rankedCommentSnapshotSize)
		if err != nil {
			return nil, nil, err
		}
	}
	var available bool
	if err := r.db.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM ranked_comment_snapshots
		        WHERE id = $1
		            AND viewer_user_id = $2
		            AND post_id = $3
		            AND expires_at > now()
		    )
	`,
		snapshotID, viewerID, postID).Scan(&available); err != nil {
		return nil, nil, fmt.Errorf("authorize ranked comment snapshot: %w", err)
	}
	if !available {
		return nil, nil, ErrInvalidRankCursor
	}

	comments := make([]Comment, 0, limit)
	for len(comments) < limit {
		rows, err := r.db.QueryContext(ctx, `
			SELECT
			    position,
			    comment_id
			FROM ranked_comment_items
			WHERE snapshot_id = $1
			    AND position >= $2
			ORDER BY
			    position
			LIMIT $3
		`,
			snapshotID, position, rankedFeedBatchSize)
		if err != nil {
			return nil, nil, fmt.Errorf("load ranked comment positions: %w", err)
		}
		ids := []int64{}
		positions := []int{}
		for rows.Next() {
			var ordinal int
			var id int64
			if err := rows.Scan(&ordinal, &id); err != nil {
				_ = rows.Close()
				return nil, nil, fmt.Errorf("scan ranked comment position: %w", err)
			}
			positions = append(positions, ordinal)
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, nil, fmt.Errorf("iterate ranked comment positions: %w", err)
		}
		_ = rows.Close()
		if len(ids) == 0 {
			break
		}

		visible, err := r.listComments(ctx, viewerID, postID, 0, len(ids), ids)
		if err != nil {
			return nil, nil, err
		}
		byID := make(map[int64]Comment, len(visible))
		for _, comment := range visible {
			byID[comment.ID] = comment
		}
		for index, id := range ids {
			position = positions[index] + 1
			if comment, ok := byID[id]; ok {
				ordinal := positions[index]
				comment.RankPosition = &ordinal
				comments = append(comments, comment)
				if len(comments) == limit {
					break
				}
			}
		}
		if len(ids) < rankedFeedBatchSize {
			break
		}
	}
	var hasMore bool
	if err := r.db.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM ranked_comment_items
		        WHERE snapshot_id = $1
		            AND position >= $2
		    )
	`,
		snapshotID, position).Scan(&hasMore); err != nil {
		return nil, nil, fmt.Errorf("check ranked comment continuation: %w", err)
	}
	if !hasMore {
		return comments, nil, nil
	}
	next := fmt.Sprintf("%s:%d", snapshotID, position)
	return comments, &next, nil
}

func (r *PostgresRepository) createRankedCommentSnapshot(ctx context.Context, viewerID, postID int64) (string, error) {
	id, err := newSnapshotID()
	if err != nil {
		return "", err
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", fmt.Errorf("begin ranked comment snapshot: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO
		    ranked_comment_snapshots (id, viewer_user_id, post_id, expires_at)
		VALUES
		    ($1, $2, $3, now() + interval '30 minutes')
	`, id, viewerID, postID); err != nil {
		return "", fmt.Errorf("create ranked comment snapshot: %w", err)
	}

	if _, err := tx.ExecContext(ctx, rankedCommentsSQL, viewerID, postID, id); err != nil {
		return "", fmt.Errorf("rank post comments: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit ranked comment snapshot: %w", err)
	}
	return id, nil
}
