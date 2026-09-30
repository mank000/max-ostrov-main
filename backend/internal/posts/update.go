package posts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"kutezh/backend/internal/contentanalysis"
	"kutezh/backend/internal/contentpolicy"
	"kutezh/backend/internal/postgres"
)

const postEditWindow = 24 * time.Hour

var ErrEditWindowClosed = errors.New("post edit window closed")

type UpdateInput struct {
	Caption  string   `json:"caption"`
	MediaIDs *[]int64 `json:"media_ids,omitempty"`
}

func canEditPost(createdAt, now time.Time) bool {
	return !now.After(createdAt.Add(postEditWindow))
}

func (s *Service) Update(ctx context.Context, userID, postID int64, input UpdateInput) (Post, error) {
	input.Caption = strings.TrimSpace(input.Caption)
	if userID <= 0 || postID <= 0 || utf8.RuneCountInString(input.Caption) > 2000 {
		return Post{}, ErrInvalidPost
	}
	if err := contentpolicy.CheckTextLocal(input.Caption); err != nil {
		return Post{}, err
	}
	if input.MediaIDs != nil {
		if len(*input.MediaIDs) > 10 || !uniqueIDs(*input.MediaIDs, 0) {
			return Post{}, ErrInvalidPost
		}
	}
	post, err := s.repository.UpdatePost(ctx, userID, postID, input, s.now())
	if err == nil {
		s.publishChange(ctx, postID, 0, "post.updated")
	}
	return post, err
}

func (r *PostgresRepository) UpdatePost(ctx context.Context, userID, postID int64, input UpdateInput, now time.Time) (Post, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Post{}, fmt.Errorf("begin post update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := contentpolicy.CheckAuthorAge(ctx, tx, userID, contentpolicy.SensitiveLanguage(input.Caption)); err != nil {
		return Post{}, err
	}

	var createdAt time.Time
	var hasMedia, isRepost bool
	err = tx.QueryRowContext(ctx, `
		SELECT post.created_at,
			EXISTS (SELECT 1 FROM post_media media WHERE media.post_id = post.id),
			(post.repost_of_post_id IS NOT NULL OR post.repost_source_deleted)
		FROM posts post
		WHERE post.id = $1 AND post.author_user_id = $2
		FOR UPDATE`, postID, userID,
	).Scan(&createdAt, &hasMedia, &isRepost)
	if errors.Is(err, sql.ErrNoRows) {
		return Post{}, ErrNotFound
	}
	if err != nil {
		return Post{}, fmt.Errorf("authorize post update: %w", err)
	}
	if !canEditPost(createdAt, now) {
		return Post{}, ErrEditWindowClosed
	}

	if input.MediaIDs != nil {
		var clip bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM clips WHERE post_id=$1)`, postID).Scan(&clip); err != nil {
			return Post{}, err
		}
		if clip {
			if err := validateClipMedia(ctx, tx, userID, *input.MediaIDs); err != nil {
				return Post{}, err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE clips SET cover_ms=LEAST(cover_ms,
				(SELECT GREATEST(0,duration_ms-1) FROM media_assets WHERE id=$2)) WHERE post_id=$1`, postID, (*input.MediaIDs)[0]); err != nil {
				return Post{}, err
			}
		}
		mediaIDs := *input.MediaIDs
		if len(mediaIDs) > 0 {
			if err := postgres.LockMediaAssets(ctx, tx, userID, mediaIDs); err != nil {
				return Post{}, err
			}
			var count int
			err = tx.QueryRowContext(ctx, `
				SELECT count(*) FROM (
					SELECT media.id
					FROM media_assets media
					WHERE media.id = ANY($1::bigint[]) AND media.owner_user_id = $2
						AND NOT EXISTS (SELECT 1 FROM attendance_media WHERE media_id = media.id)
						AND NOT EXISTS (SELECT 1 FROM comment_media WHERE media_id = media.id)
					AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_media_id = media.id)
						AND (
							NOT EXISTS (SELECT 1 FROM post_media WHERE media_id = media.id)
							OR EXISTS (SELECT 1 FROM post_media WHERE media_id = media.id AND post_id = $3)
						)
				) available`, mediaIDs, userID, postID,
			).Scan(&count)
			if err != nil {
				return Post{}, fmt.Errorf("validate updated post media: %w", err)
			}
			if count != len(mediaIDs) {
				return Post{}, ErrInvalidMedia
			}
		}
		hasMedia = len(mediaIDs) > 0
	}

	if input.Caption == "" && !hasMedia && !isRepost {
		return Post{}, ErrInvalidPost
	}

	if _, err := tx.ExecContext(ctx, "UPDATE posts SET caption = $1 WHERE id = $2", input.Caption, postID); err != nil {
		return Post{}, fmt.Errorf("update post caption: %w", err)
	}

	if input.MediaIDs != nil {
		if _, err := tx.ExecContext(ctx, "DELETE FROM post_media WHERE post_id = $1", postID); err != nil {
			return Post{}, fmt.Errorf("detach post media: %w", err)
		}
		if len(*input.MediaIDs) > 0 {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO post_media (post_id, media_id, position)
				SELECT $1, value, position - 1
				FROM unnest($2::bigint[]) WITH ORDINALITY AS item(value, position)`, postID, *input.MediaIDs); err != nil {
				return Post{}, fmt.Errorf("attach updated post media: %w", err)
			}
		}
	}

	if err := contentanalysis.EnqueuePost(ctx, tx, postID); err != nil {
		return Post{}, err
	}
	if err := tx.Commit(); err != nil {
		return Post{}, fmt.Errorf("commit post update: %w", err)
	}
	return r.get(ctx, userID, postID)
}
