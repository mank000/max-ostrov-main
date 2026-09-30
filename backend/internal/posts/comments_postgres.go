package posts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"kutezh/backend/internal/contentpolicy"
	"kutezh/backend/internal/notifications"
	"kutezh/backend/internal/postgres"
)

func decodeCommentMedia(raw []byte, target *[]Media) error {
	if len(raw) == 0 {
		*target = []Media{}
		return nil
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("decode comment media: %w", err)
	}
	if *target == nil {
		*target = []Media{}
	}
	return nil
}

func (r *PostgresRepository) ListComments(ctx context.Context, userID, postID, beforeID int64, limit int) ([]Comment, error) {
	return r.listComments(ctx, userID, postID, beforeID, limit, nil)
}

func (r *PostgresRepository) listComments(ctx context.Context, userID, postID, beforeID int64, limit int, selectedIDs []int64) ([]Comment, error) {
	var authorized bool
	if err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM posts post
			WHERE post.id = $2
				AND `+postVisibleToViewerSQL+`
				AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = post.author_user_id)
					OR (block.blocker_id = post.author_user_id AND block.blocked_id = $1)
			)
		)`, userID, postID).Scan(&authorized); err != nil {
		return nil, fmt.Errorf("authorize post comments: %w", err)
	}
	if !authorized {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(ctx, listCommentsSQL, userID, postID, beforeID, limit, selectedIDs != nil, selectedIDs)
	if err != nil {
		return nil, fmt.Errorf("list post comments: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()
	items := make([]Comment, 0, limit)
	for rows.Next() {
		var item Comment
		var authorJSON, replyToJSON, mediaJSON []byte
		if err := rows.Scan(&item.ID, &item.PostID, &item.ParentCommentID, &item.Body, &item.LikeCount, &item.LikedByMe, &item.CreatedAt, &authorJSON, &replyToJSON, &mediaJSON); err != nil {
			return nil, fmt.Errorf("scan post comment: %w", err)
		}
		if err := json.Unmarshal(authorJSON, &item.Author); err != nil {
			return nil, fmt.Errorf("decode comment author: %w", err)
		}
		if len(replyToJSON) > 0 {
			var replyTo User
			if err := json.Unmarshal(replyToJSON, &replyTo); err != nil {
				return nil, fmt.Errorf("decode comment reply target: %w", err)
			}
			item.ReplyTo = &replyTo
		}
		if err := decodeCommentMedia(mediaJSON, &item.Media); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) validateCommentMedia(ctx context.Context, tx *sql.Tx, userID int64, mediaIDs []int64, commentID int64) error {
	if len(mediaIDs) == 0 {
		return nil
	}
	if err := postgres.LockMediaAssets(ctx, tx, userID, mediaIDs); err != nil {
		return err
	}
	var count int
	err := tx.QueryRowContext(ctx, `
		SELECT
		    count(*)
		FROM (
		        SELECT
		            media.id
		        FROM media_assets media
		        WHERE media.id = ANY ($1::bigint[])
		            AND media.owner_user_id = $2
		            AND media.moderated_safe
		            AND NOT EXISTS (
		                SELECT
		                    1
		                FROM post_media
		                WHERE media_id = media.id
		            )
		            AND NOT EXISTS (
		                SELECT
		                    1
		                FROM attendance_media
		                WHERE media_id = media.id
		            )
		            AND NOT EXISTS (
		                SELECT
		                    1
		                FROM users
		                WHERE avatar_media_id = media.id
		            )
		            AND NOT EXISTS (
		                SELECT
		                    1
		                FROM user_profile_avatars
		                WHERE media_id = media.id
		                    OR crop_media_id = media.id
		            )
		            AND (
		                NOT EXISTS (
		                    SELECT
		                        1
		                    FROM comment_media
		                    WHERE media_id = media.id
		                )
		                OR (
		                    $3 > 0
		                    AND EXISTS (
		                        SELECT
		                            1
		                        FROM comment_media
		                        WHERE media_id = media.id
		                            AND comment_id = $3
		                    )
		                )
		            )
		    ) available
	`, mediaIDs, userID, commentID).Scan(&count)
	if err != nil {
		return fmt.Errorf("validate comment media: %w", err)
	}
	if count != len(mediaIDs) {
		return ErrInvalidMedia
	}
	return nil
}

func (r *PostgresRepository) attachCommentMedia(ctx context.Context, tx *sql.Tx, commentID int64, mediaIDs []int64) error {
	if len(mediaIDs) == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO
		    comment_media (comment_id, media_id, position)
		SELECT
		    $1,
		    value,
		    position - 1
		FROM unnest($2::bigint[]) WITH ORDINALITY AS item (value, position)
	`, commentID, mediaIDs); err != nil {
		return fmt.Errorf("attach comment media: %w", err)
	}
	return nil
}

func syncCommentAIReview(ctx context.Context, tx *sql.Tx, commentID, authorID int64, body string, labels []string) error {
	if len(labels) == 0 {
		_, err := tx.ExecContext(ctx, `
			UPDATE moderation_reports
			SET status = 'dismissed',
			    version = version + 1
			WHERE target_type = 'comment'
			    AND target_id = $1
			    AND source = 'ai'
			    AND status = 'open'
		`, commentID)
		return err
	}
	labelsJSON, err := json.Marshal(labels)
	if err != nil {
		return fmt.Errorf("encode comment moderation labels: %w", err)
	}
	reason := "ИИ: требуется проверка текста комментария. Это сигнал для модератора, не установленное нарушение."
	_, err = tx.ExecContext(ctx, `
		INSERT INTO
		    moderation_reports (target_type, target_id, reason, target_snapshot, source)
		VALUES
		    (
		        'comment',
		        $1,
		        $4,
		        jsonb_build_object(
		            'id',
		            $1::bigint,
		            'author_user_id',
		            $2::bigint,
		            'body',
		            $3::text,
		            'ai_review_labels',
		            $5::jsonb
		        ),
		        'ai'
		    )
		ON CONFLICT (target_type, target_id)
		WHERE source = 'ai'
		    AND status = 'open' DO UPDATE
		SET reason = EXCLUDED.reason,
		    target_snapshot = EXCLUDED.target_snapshot,
		    version = moderation_reports.version + 1
	`, commentID, authorID, body, reason, string(labelsJSON))
	return err
}

func (r *PostgresRepository) CreateComment(ctx context.Context, userID, postID int64, body string, mediaIDs []int64, parentCommentID *int64, now time.Time) (Comment, *int64, error) {
	analysis, hasAnalysis := contentpolicy.DiscussionAnalysisFromContext(ctx, body)
	restricted, ageErr := contentpolicy.AdultText(ctx, body)
	if ageErr != nil {
		return Comment{}, nil, ageErr
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Comment{}, nil, fmt.Errorf("begin comment creation: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := contentpolicy.CheckAuthorAge(ctx, tx, userID, restricted); err != nil {
		return Comment{}, nil, err
	}
	var eventID sql.NullInt64
	var authorID int64
	var eventTitle sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT
		    post.event_id,
		    post.author_user_id,
		    event.title
		FROM posts post
		    LEFT JOIN events event ON event.id = post.event_id
		WHERE post.id = $2
		    AND
	`+postVisibleToViewerSQL+`
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = post.author_user_id)
					OR (block.blocker_id = post.author_user_id AND block.blocked_id = $1)
		) FOR SHARE OF post`, userID, postID).Scan(&eventID, &authorID, &eventTitle)
	if errors.Is(err, sql.ErrNoRows) {
		return Comment{}, nil, ErrNotFound
	}
	if err != nil {
		return Comment{}, nil, fmt.Errorf("authorize comment creation: %w", err)
	}

	notificationTitle := "Новый комментарий"
	notificationBody := "К вашей публикации добавили комментарий."
	if eventTitle.Valid {
		notificationBody = "К вашей публикации о мероприятии «" + eventTitle.String + "» добавили комментарий."
	}
	threadParentCommentID := parentCommentID
	var replyToUserID *int64
	if parentCommentID != nil {
		var parentAuthorID, rootCommentID int64
		err = tx.QueryRowContext(ctx, `
			WITH RECURSIVE
			    ancestors AS (
			        SELECT
			            comment.id,
			            comment.parent_comment_id
			        FROM post_comments comment
			        WHERE comment.id = $1
			            AND comment.post_id = $2
			            AND comment.moderation_hidden_at IS NULL
			            AND comment_safety_visible (comment.id, $3)
			        UNION ALL
			        SELECT
			            parent.id,
			            parent.parent_comment_id
			        FROM post_comments parent
			            JOIN ancestors child ON child.parent_comment_id = parent.id
			        WHERE parent.post_id = $2
			            AND parent.moderation_hidden_at IS NULL
			            AND comment_safety_visible (parent.id, $3)
			    )
			SELECT
			    comment.author_user_id,
			    root.id
			FROM post_comments comment
			    JOIN ancestors root ON root.parent_comment_id IS NULL
			WHERE comment.id = $1
			    AND comment.post_id = $2
			    AND comment.moderation_hidden_at IS NULL
			    AND comment_safety_visible (comment.id, $3)
			    AND NOT EXISTS (
			        SELECT
			            1
			        FROM user_blocks block
			        WHERE (
			                block.blocker_id = $3
			                AND block.blocked_id = comment.author_user_id
			            )
			            OR (
			                block.blocker_id = comment.author_user_id
			                AND block.blocked_id = $3
			            )
			    )
			FOR SHARE OF
			    comment
		`, *parentCommentID, postID, userID).Scan(&parentAuthorID, &rootCommentID)
		if errors.Is(err, sql.ErrNoRows) {
			return Comment{}, nil, ErrInvalidComment
		}
		if err != nil {
			return Comment{}, nil, fmt.Errorf("validate parent comment: %w", err)
		}
		threadParentCommentID = &rootCommentID
		replyTargetID := parentAuthorID
		replyToUserID = &replyTargetID
		authorID = parentAuthorID
		notificationTitle = "Новый ответ"
		notificationBody = "На ваш комментарий ответили."
		if eventTitle.Valid {
			notificationBody = "На ваш комментарий к мероприятию «" + eventTitle.String + "» ответили."
		}
	}
	if err := r.validateCommentMedia(ctx, tx, userID, mediaIDs, 0); err != nil {
		return Comment{}, nil, err
	}

	var item Comment
	err = tx.QueryRowContext(ctx, `
		INSERT INTO
		    post_comments (
		        post_id,
		        author_user_id,
		        body,
		        parent_comment_id,
		        reply_to_user_id,
		        created_at,
		        adult_only,
		        age_classified
		    )
		VALUES
		    ($1, $2, $3, $4, $5, $6, $7, true)
		RETURNING id,
		    post_id,
		    parent_comment_id,
		    body,
		    created_at
	`,
		postID, userID, body, threadParentCommentID, replyToUserID, now, restricted,
	).Scan(&item.ID, &item.PostID, &item.ParentCommentID, &item.Body, &item.CreatedAt)
	if err != nil {
		return Comment{}, nil, fmt.Errorf("create post comment: %w", err)
	}
	if err := r.attachCommentMedia(ctx, tx, item.ID, mediaIDs); err != nil {
		return Comment{}, nil, err
	}
	if hasAnalysis {
		if err := syncCommentAIReview(ctx, tx, item.ID, userID, body, analysis.Review); err != nil {
			return Comment{}, nil, fmt.Errorf("sync comment moderation: %w", err)
		}
	}

	var authorJSON, replyToJSON, mediaJSON []byte
	err = tx.QueryRowContext(ctx, `
		SELECT
		    jsonb_build_object(
		        'id',
		        author.id,
		        'username',
		        author.username,
		        'display_name',
		        author.display_name,
		        'photo_url',
		        CASE
		            WHEN author.avatar_media_id IS NULL THEN author.provider_photo_url
		            ELSE '/api/v1/media/' || author.avatar_media_id::text || '/content'
		        END,
		        'equipped_decoration_code',
		        author.equipped_decoration_code
		    ),
		    CASE
		        WHEN reply_to.id IS NULL THEN NULL
		        ELSE jsonb_build_object(
		            'id',
		            reply_to.id,
		            'username',
		            reply_to.username,
		            'display_name',
		            reply_to.display_name,
		            'photo_url',
		            CASE
		                WHEN reply_to.avatar_media_id IS NULL THEN reply_to.provider_photo_url
		                ELSE '/api/v1/media/' || reply_to.avatar_media_id::text || '/content'
		            END,
		            'equipped_decoration_code',
		            reply_to.equipped_decoration_code
		        )
		    END,
		    COALESCE(
		        (
		            SELECT
		                jsonb_agg(
		                    jsonb_build_object(
		                        'id',
		                        media.id,
		                        'mime_type',
		                        media.mime_type,
		                        'width',
		                        media.width,
		                        'height',
		                        media.height,
		                        'duration_ms',
		                        media.duration_ms,
		                        'url',
		                        '/api/v1/media/' || media.id::text || '/content'
		                    )
		                    ORDER BY
		                        link.position
		                )
		            FROM comment_media link
		                JOIN media_assets media ON media.id = link.media_id
		            WHERE link.comment_id = comment.id
		        ),
		        '[]'::jsonb
		    )
		FROM post_comments comment
		    JOIN users author ON author.id = comment.author_user_id
		    LEFT JOIN users reply_to ON reply_to.id = comment.reply_to_user_id
		WHERE comment.id = $1
	`, item.ID).Scan(&authorJSON, &replyToJSON, &mediaJSON)
	if err != nil {
		return Comment{}, nil, fmt.Errorf("load created comment: %w", err)
	}
	if err := json.Unmarshal(authorJSON, &item.Author); err != nil {
		return Comment{}, nil, fmt.Errorf("decode comment author: %w", err)
	}
	if len(replyToJSON) > 0 {
		var replyTo User
		if err := json.Unmarshal(replyToJSON, &replyTo); err != nil {
			return Comment{}, nil, fmt.Errorf("decode comment reply target: %w", err)
		}
		item.ReplyTo = &replyTo
	}
	if err := decodeCommentMedia(mediaJSON, &item.Media); err != nil {
		return Comment{}, nil, err
	}

	var recipientID *int64
	if authorID != userID {
		recipientID = &authorID
		_, err = tx.ExecContext(ctx, `
			INSERT INTO
			    background_jobs (kind, payload, dedupe_key, run_at)
			VALUES
			    (
			        'notification',
			        jsonb_build_object(
			            'user_id',
			            $1::bigint,
			            'kind',
			            'post_comment',
			            'title',
			            $6::text,
			            'body',
			            $7::text,
			            'event_id',
			            $2::bigint,
			            'post_id',
			            $8::bigint,
			            'actor_user_id',
			            $3::bigint,
			            'dedupe_key',
			            'post_comment:' || $4::bigint::text
			        ),
			        'post_comment:' || $4::bigint::text,
			        $5
			    )
			ON CONFLICT (dedupe_key) DO NOTHING
		`, authorID, eventID, userID, item.ID, now, notificationTitle, notificationBody, postID)
		if err != nil {
			return Comment{}, nil, fmt.Errorf("enqueue comment notification: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Comment{}, nil, fmt.Errorf("commit comment creation: %w", err)
	}
	return item, recipientID, nil
}

func (r *PostgresRepository) UpdateComment(ctx context.Context, userID, commentID int64, body string, mediaIDs []int64) error {
	analysis, hasAnalysis := contentpolicy.DiscussionAnalysisFromContext(ctx, body)
	restricted, ageErr := contentpolicy.AdultText(ctx, body)
	if ageErr != nil {
		return ageErr
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin comment update: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()
	if err := contentpolicy.CheckAuthorAge(ctx, tx, userID, restricted); err != nil {
		return err
	}
	var lockedID int64
	err = tx.QueryRowContext(ctx, `
		SELECT
		    id
		FROM post_comments
		WHERE id = $1
		    AND author_user_id = $2
		FOR UPDATE
	`, commentID, userID).Scan(&lockedID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("authorize comment update: %w", err)
	}
	if err := r.validateCommentMedia(ctx, tx, userID, mediaIDs, commentID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE post_comments SET body = $3, adult_only=$4,age_classified=true WHERE id = $1 AND author_user_id = $2", commentID, userID, body, restricted); err != nil {
		return fmt.Errorf("update post comment: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM comment_media WHERE comment_id = $1", commentID); err != nil {
		return fmt.Errorf("detach comment media: %w", err)
	}
	if err := r.attachCommentMedia(ctx, tx, commentID, mediaIDs); err != nil {
		return err
	}
	if hasAnalysis {
		if err := syncCommentAIReview(ctx, tx, commentID, userID, body, analysis.Review); err != nil {
			return fmt.Errorf("sync comment moderation: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit comment update: %w", err)
	}
	return nil
}

func (r *PostgresRepository) DeleteComment(ctx context.Context, userID, commentID int64) error {
	result, err := r.db.ExecContext(ctx, `
		DELETE FROM post_comments comment USING posts post
		WHERE comment.id = $1
		    AND post.id = comment.post_id
		    AND (
		        comment.author_user_id = $2
		        OR post.author_user_id = $2
		    )
	`, commentID, userID)
	if err != nil {
		return fmt.Errorf("delete post comment: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read comment deletion: %w", err)
	}
	if deleted == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) SetCommentLike(ctx context.Context, userID, commentID int64, liked bool) (*int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin comment like: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var authorID, postID int64
	var isClip bool
	var commentBody string
	err = tx.QueryRowContext(ctx, `
		SELECT
		    comment.author_user_id,
		    comment.post_id,
		    EXISTS (
		        SELECT
		            1
		        FROM clips clip
		        WHERE clip.post_id = comment.post_id
		    ),
		    left(btrim(comment.body), 80)
		FROM post_comments comment
		    JOIN posts post ON post.id = comment.post_id
		WHERE comment.id = $2
		    AND comment.moderation_hidden_at IS NULL
		    AND comment_safety_visible (comment.id, $1)
		    AND EXISTS (
		        SELECT
		            1
		        FROM users comment_author
		        WHERE comment_author.id = comment.author_user_id
		            AND comment_author.moderation_suspended_at IS NULL
		    )
		    AND
	`+postVisibleToViewerSQL+`
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = post.author_user_id)
					OR (block.blocker_id = post.author_user_id AND block.blocked_id = $1)
			)
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = comment.author_user_id)
					OR (block.blocker_id = comment.author_user_id AND block.blocked_id = $1)
			)
		FOR SHARE OF comment, post`, userID, commentID).Scan(&authorID, &postID, &isClip, &commentBody)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("authorize comment like: %w", err)
	}

	var recipientID *int64
	if liked {
		var created bool
		if err := tx.QueryRowContext(ctx, `
			WITH
			    inserted AS (
			        INSERT INTO
			            comment_likes (comment_id, user_id)
			        VALUES
			            ($1, $2)
			        ON CONFLICT DO NOTHING
			        RETURNING 1
			    )
			SELECT
			    EXISTS (
			        SELECT
			            1
			        FROM inserted
			    )
		`, commentID, userID).Scan(&created); err != nil {
			return nil, fmt.Errorf("like comment: %w", err)
		}
		if created && isClip && authorID != userID {
			dedupeKey := fmt.Sprintf("comment_like:%d:%d", commentID, userID)
			body := "Понравился ваш комментарий к видео."
			if commentBody != "" {
				body = "Понравился ваш комментарий «" + commentBody + "»."
			}
			var notificationID int64
			err := tx.QueryRowContext(ctx, `
				INSERT INTO
				    notifications (user_id, kind, title, body, post_id, actor_user_id, dedupe_key)
				VALUES
				    ($1, 'comment_like', 'Новая отметка «Нравится»', $2, $3, $4, $5)
				ON CONFLICT (user_id, dedupe_key) DO NOTHING
				RETURNING id
			`, authorID, body, postID, userID, dedupeKey).Scan(&notificationID)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return nil, fmt.Errorf("create comment like notification: %w", err)
			}
			if err == nil {
				if err := notifications.EnqueueBotDelivery(ctx, tx, notificationID); err != nil {
					return nil, err
				}
			}
			recipient := authorID
			recipientID = &recipient
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM comment_likes
			WHERE comment_id = $1
			    AND user_id = $2
		`, commentID, userID); err != nil {
			return nil, fmt.Errorf("unlike comment: %w", err)
		}
		if isClip && authorID != userID {
			dedupeKey := fmt.Sprintf("comment_like:%d:%d", commentID, userID)
			if _, err := tx.ExecContext(ctx, `
				UPDATE notifications
				SET read_at = COALESCE(read_at, now())
				WHERE user_id = $1
				    AND kind = 'comment_like'
				    AND dedupe_key = $2
				    AND read_at IS NULL
			`, authorID, dedupeKey); err != nil {
				return nil, fmt.Errorf("retire comment like notification: %w", err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit comment like: %w", err)
	}
	return recipientID, nil
}
