package posts

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"kutezh/backend/internal/contentpolicy"
	"time"

	"kutezh/backend/internal/contentanalysis"
	"kutezh/backend/internal/postgres"
)

type repostSource struct {
	ID         int64
	EventID    *int64
	Visibility string
	City       string
}

func (r *PostgresRepository) resolveRepostSource(ctx context.Context, tx *sql.Tx, userID, sourceID int64) (repostSource, error) {
	sourceVisibleSQL := postVisibleToViewerFor("source_post", "$1")
	rootVisibleSQL := postVisibleToViewerFor("root_post", "$1")
	var source repostSource
	err := tx.QueryRowContext(ctx, `
		SELECT root_post.id, root_post.event_id, root_post.visibility, root_post.city
		FROM posts source_post
		JOIN posts root_post ON root_post.id = COALESCE(source_post.repost_of_post_id, source_post.id)
		WHERE source_post.id = $2
			AND NOT source_post.repost_source_deleted
			AND NOT EXISTS (SELECT 1 FROM clips clip WHERE clip.post_id = root_post.id)
			AND (`+sourceVisibleSQL+`)
			AND (`+rootVisibleSQL+`)
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = source_post.author_user_id)
					OR (block.blocker_id = source_post.author_user_id AND block.blocked_id = $1)
			)
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $1 AND block.blocked_id = root_post.author_user_id)
					OR (block.blocker_id = root_post.author_user_id AND block.blocked_id = $1)
			)
		FOR SHARE OF source_post, root_post`, userID, sourceID,
	).Scan(&source.ID, &source.EventID, &source.Visibility, &source.City)
	if errors.Is(err, sql.ErrNoRows) {
		return repostSource{}, ErrNotFound
	}
	if err != nil {
		return repostSource{}, fmt.Errorf("resolve repost source: %w", err)
	}
	return source, nil
}

func (r *PostgresRepository) Create(
	ctx context.Context,
	userID int64,
	idempotencyKey string,
	idempotencyHash []byte,
	input CreateInput,
	now time.Time,
) (Post, []int64, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Post{}, nil, fmt.Errorf("begin post creation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := contentpolicy.CheckAuthorAge(ctx, tx, userID, contentpolicy.SensitiveLanguage(input.Caption)); err != nil {
		return Post{}, nil, err
	}

	var repostViaPostID *int64
	if input.RepostOfPostID != nil {
		directSourceID := *input.RepostOfPostID
		source, resolveErr := r.resolveRepostSource(ctx, tx, userID, directSourceID)
		if resolveErr != nil {
			return Post{}, nil, resolveErr
		}
		rootID := source.ID
		input.RepostOfPostID = &rootID
		repostViaPostID = &directSourceID
		if input.City == "" {
			input.City = source.City
		}
		switch source.Visibility {
		case "friends":
			input.Visibility = "friends"
			input.EventID = nil
		case "event":
			if source.EventID == nil {
				return Post{}, nil, ErrNotFound
			}
			input.Visibility = "event"
			input.EventID = source.EventID
		}
	}

	var eventTitle string
	postCity := input.City
	if input.EventID != nil {
		err = tx.QueryRowContext(ctx, `
			SELECT event.title, event.city
			FROM events event
			WHERE event.id = $2
				AND (event.created_by_user_id = $1 OR EXISTS (
					SELECT 1 FROM event_participants participant
					WHERE participant.event_id = event.id AND participant.user_id = $1
				))
			FOR SHARE OF event`, userID, *input.EventID,
		).Scan(&eventTitle, &postCity)
		if errors.Is(err, sql.ErrNoRows) {
			var exists bool
			if checkErr := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM events WHERE id = $1)", *input.EventID).Scan(&exists); checkErr != nil {
				return Post{}, nil, fmt.Errorf("check post event: %w", checkErr)
			}
			if exists {
				return Post{}, nil, ErrParticipationRequired
			}
			return Post{}, nil, ErrNotFound
		}
		if err != nil {
			return Post{}, nil, fmt.Errorf("authorize post creation: %w", err)
		}
	}

	var postID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO posts (event_id, author_user_id, visibility, city, caption, created_at, idempotency_key, idempotency_hash, repost_of_post_id, repost_via_post_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT DO NOTHING
		RETURNING id`, input.EventID, userID, input.Visibility, postCity, input.Caption, now, idempotencyKey, idempotencyHash, input.RepostOfPostID, repostViaPostID,
	).Scan(&postID)
	if errors.Is(err, sql.ErrNoRows) {
		var storedHash []byte
		lookupErr := tx.QueryRowContext(ctx, `
			SELECT id, idempotency_hash FROM posts
			WHERE author_user_id = $1 AND idempotency_key = $2`,
			userID, idempotencyKey,
		).Scan(&postID, &storedHash)
		if lookupErr == nil && !bytes.Equal(storedHash, idempotencyHash) {
			return Post{}, nil, ErrIdempotencyConflict
		}
		if errors.Is(lookupErr, sql.ErrNoRows) && input.RepostOfPostID != nil {
			// A new operation key (or simultaneous request) must still return
			// the one existing wall repost instead of creating another copy.
			lookupErr = tx.QueryRowContext(ctx, `
				SELECT id FROM posts
				WHERE author_user_id = $1 AND repost_of_post_id = $2
					AND moderation_hidden_at IS NULL`, userID, *input.RepostOfPostID,
			).Scan(&postID)
		}
		if lookupErr != nil {
			return Post{}, nil, fmt.Errorf("read existing post: %w", lookupErr)
		}
		_ = tx.Rollback()
		post, err := r.get(ctx, userID, postID)
		return post, nil, err
	}
	if err != nil {
		return Post{}, nil, fmt.Errorf("create post: %w", err)
	}

	if len(input.MediaIDs) > 0 {
		if err := postgres.LockMediaAssets(ctx, tx, userID, input.MediaIDs); err != nil {
			return Post{}, nil, err
		}
		var count int
		err = tx.QueryRowContext(ctx, `
			SELECT count(*) FROM (
				SELECT media.id
				FROM media_assets media
				WHERE media.id = ANY($1::bigint[]) AND media.owner_user_id = $2
					AND NOT EXISTS (SELECT 1 FROM post_media WHERE media_id = media.id)
					AND NOT EXISTS (SELECT 1 FROM comment_media WHERE media_id = media.id)
					AND NOT EXISTS (SELECT 1 FROM attendance_media WHERE media_id = media.id)
					AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_media_id = media.id)
			) available`,
			input.MediaIDs, userID,
		).Scan(&count)
		if err != nil {
			return Post{}, nil, fmt.Errorf("validate post media: %w", err)
		}
		if count != len(input.MediaIDs) {
			return Post{}, nil, ErrInvalidMedia
		}
	}

	if input.IsClip {
		if err := validateClipMedia(ctx, tx, userID, input.MediaIDs); err != nil {
			return Post{}, nil, err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO clips(post_id,cover_ms)
			SELECT $1,$2 FROM media_assets WHERE id=$3 AND $2 < duration_ms`, postID, input.CoverMS, input.MediaIDs[0])
		if err != nil {
			return Post{}, nil, err
		}
		if count, err := result.RowsAffected(); err != nil || count != 1 {
			return Post{}, nil, ErrInvalidMedia
		}
	}

	if len(input.TaggedUserIDs) > 0 {
		var count int
		if input.EventID != nil {
			err = tx.QueryRowContext(ctx, `
				SELECT count(*)
				FROM users tagged
				WHERE tagged.id = ANY($2::bigint[])
					AND tagged.participant_visibility = 'participants'
					AND (EXISTS (
						SELECT 1 FROM event_participants participant
						WHERE participant.event_id = $1 AND participant.user_id = tagged.id
					) OR EXISTS (
						SELECT 1 FROM events event
						WHERE event.id = $1 AND event.created_by_user_id = tagged.id
					))
					AND NOT EXISTS (
						SELECT 1 FROM user_blocks block
						WHERE (block.blocker_id = $3 AND block.blocked_id = tagged.id)
							OR (block.blocker_id = tagged.id AND block.blocked_id = $3)
					)`, *input.EventID, input.TaggedUserIDs, userID,
			).Scan(&count)
		} else {
			err = tx.QueryRowContext(ctx, `
				SELECT count(*) FROM users tagged
				WHERE tagged.id = ANY($1::bigint[]) AND EXISTS (
					SELECT 1 FROM friendships friendship
					WHERE friendship.user_low_id = LEAST($2, tagged.id)
						AND friendship.user_high_id = GREATEST($2, tagged.id)
				) AND NOT EXISTS (
					SELECT 1 FROM user_blocks block
					WHERE (block.blocker_id = $2 AND block.blocked_id = tagged.id)
						OR (block.blocker_id = tagged.id AND block.blocked_id = $2)
				)`, input.TaggedUserIDs, userID,
			).Scan(&count)
		}
		if err != nil {
			return Post{}, nil, fmt.Errorf("validate participant tags: %w", err)
		}
		if count != len(input.TaggedUserIDs) {
			return Post{}, nil, ErrInvalidTag
		}
	}

	if len(input.MediaIDs) > 0 {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO post_media (post_id, media_id, position)
			SELECT $1, value, position - 1
			FROM unnest($2::bigint[]) WITH ORDINALITY AS item(value, position)`, postID, input.MediaIDs)
		if err != nil {
			return Post{}, nil, fmt.Errorf("attach post media: %w", err)
		}
	}
	if len(input.TaggedUserIDs) > 0 {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO post_participant_tags (post_id, user_id)
			SELECT $1, unnest($2::bigint[])`, postID, input.TaggedUserIDs)
		if err != nil {
			return Post{}, nil, fmt.Errorf("tag post participants: %w", err)
		}
		notificationBody := "Вас отметили в публикации."
		if input.EventID != nil {
			notificationBody = "На мероприятии «" + eventTitle + "» появилась публикация с вашей отметкой."
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO background_jobs (kind, payload, dedupe_key, run_at)
			SELECT 'notification', jsonb_build_object(
				'user_id', tagged_user_id,
				'kind', 'post_tag',
				'title', 'Вас отметили в публикации',
				'body', $4::text,
				'event_id', $2::bigint,
				'actor_user_id', $3::bigint,
				'dedupe_key', 'post_tag:' || $1::bigint::text || ':' || tagged_user_id::text
			), 'post_tag:' || $1::bigint::text || ':' || tagged_user_id::text, $5
			FROM unnest($6::bigint[]) AS tagged_user_id
			ON CONFLICT (dedupe_key) DO NOTHING`,
			postID, input.EventID, userID, notificationBody, now, input.TaggedUserIDs,
		)
		if err != nil {
			return Post{}, nil, fmt.Errorf("enqueue post notifications: %w", err)
		}
	}
	if err := contentanalysis.EnqueuePost(ctx, tx, postID); err != nil {
		return Post{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return Post{}, nil, fmt.Errorf("commit post creation: %w", err)
	}

	post, err := r.get(ctx, userID, postID)
	if err != nil {
		return Post{}, nil, err
	}
	recipients := append([]int64{userID}, input.TaggedUserIDs...)
	return post, recipients, nil
}
