package posts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type PostgresRepository struct {
	db *sql.DB
}

// A clip uses a post for shared reactions and moderation, but belongs to Video.
// Reposts of clips must not turn that content into a social publication either.
const socialPostCondition = `NOT EXISTS (
	SELECT 1 FROM clips clip WHERE clip.post_id = COALESCE(post.repost_of_post_id, post.id)
)`

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) IsClip(ctx context.Context, postID int64) (bool, error) {
	var clip bool
	if err := r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM clips WHERE post_id=$1)`, postID).Scan(&clip); err != nil {
		return false, fmt.Errorf("check clip post: %w", err)
	}
	return clip, nil
}

func (r *PostgresRepository) ListEvent(ctx context.Context, userID, eventID, beforeID int64, limit int) ([]Post, error) {
	var authorized bool
	err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM events event
			WHERE event.id = $2 AND (
				event.created_by_user_id = $1 OR EXISTS (
					SELECT 1 FROM event_participants participant
					WHERE participant.user_id = $1 AND participant.event_id = event.id
				)
			)
		)`,
		userID, eventID,
	).Scan(&authorized)
	if err != nil {
		return nil, fmt.Errorf("authorize event posts: %w", err)
	}
	if !authorized {
		var exists bool
		if err := r.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM events WHERE id = $1)", eventID).Scan(&exists); err != nil {
			return nil, fmt.Errorf("check event posts: %w", err)
		}
		if exists {
			return nil, ErrParticipationRequired
		}
		return nil, ErrNotFound
	}
	return r.list(ctx, `post.event_id = $1 AND ($2::bigint = 0 OR post.id < $2)`, []any{eventID, beforeID, limit, userID}, limit)
}

func (r *PostgresRepository) ListAuthor(ctx context.Context, userID, beforeID int64, limit int) ([]Post, error) {
	return r.list(ctx, `post.author_user_id = $1 AND ($2::bigint = 0 OR post.id < $2) AND `+socialPostCondition, []any{userID, beforeID, limit, userID}, limit)
}

func (r *PostgresRepository) ListProfile(ctx context.Context, viewerID, targetID, beforeID int64, limit int) ([]Post, error) {
	return r.list(ctx,
		`post.author_user_id = $1
			AND ($2::bigint = 0 OR post.id < $2)
			AND ($4 = $1 OR EXISTS (SELECT 1 FROM user_identities identity
				WHERE identity.user_id = post.author_user_id AND identity.status = 'verified'))
			AND ($4 = $1 OR post.visibility IN ('city', 'friends'))
			AND `+socialPostCondition,
		[]any{targetID, beforeID, limit, viewerID}, limit,
	)
}

func (r *PostgresRepository) ListTagged(ctx context.Context, viewerID, targetID, beforeID int64, limit int) ([]Post, error) {
	return r.list(ctx,
		`EXISTS (
			SELECT 1 FROM post_participant_tags tag
			JOIN users tagged ON tagged.id = tag.user_id
			WHERE tag.post_id = post.id AND tag.user_id = $1
				AND (post.event_id IS NULL OR tagged.participant_visibility = 'participants' OR $4 = $1)
		)
		AND ($2::bigint = 0 OR post.id < $2)
		AND `+socialPostCondition,
		[]any{targetID, beforeID, limit, viewerID}, limit,
	)
}

func (r *PostgresRepository) Feed(ctx context.Context, userID, beforeID int64, limit int, scope FeedScope, city string) ([]Post, error) {
	var condition string
	args := []any{userID, beforeID, limit, userID}
	switch scope {
	case FeedScopeAll:
		condition = `$1::bigint > 0 AND ($2::bigint = 0 OR post.id < $2)`
	case FeedScopeCity:
		condition = `$1::bigint > 0
			AND post.visibility IN ('city', 'event')
			AND lower(btrim(post.city)) = lower(btrim($5))
			AND ($2::bigint = 0 OR post.id < $2)`
		args = append(args, city)
	case FeedScopeFriends:
		condition = `post.author_user_id <> $1
			AND post.visibility IN ('city', 'friends')
			AND EXISTS (
				SELECT 1 FROM friendships friendship
				WHERE friendship.user_low_id = LEAST($1, post.author_user_id)
					AND friendship.user_high_id = GREATEST($1, post.author_user_id)
			)
			AND ($2::bigint = 0 OR post.id < $2)`
	default:
		return nil, ErrInvalidPost
	}
	condition += ` AND EXISTS (SELECT 1 FROM user_identities identity
		WHERE identity.user_id = post.author_user_id AND identity.status = 'verified')
		AND NOT EXISTS (SELECT 1 FROM feed_feedback feedback
			WHERE feedback.user_id=$1 AND feedback.post_id=post.id)
		AND ` + socialPostCondition
	return r.list(ctx, condition, args, limit)
}

func (r *PostgresRepository) Delete(ctx context.Context, userID, postID int64) error {
	result, err := r.db.ExecContext(ctx, "DELETE FROM posts WHERE id = $1 AND author_user_id = $2", postID, userID)
	if err != nil {
		return fmt.Errorf("delete post: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read post deletion: %w", err)
	}
	if deleted == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) Get(ctx context.Context, userID, postID int64) (Post, error) {
	return r.get(ctx, userID, postID)
}

func (r *PostgresRepository) get(ctx context.Context, userID, postID int64) (Post, error) {
	items, err := r.list(ctx, `post.id = $1 AND $2::bigint = 0
		AND (post.author_user_id = $4 OR EXISTS (SELECT 1 FROM user_identities identity
			WHERE identity.user_id = post.author_user_id AND identity.status = 'verified'))`,
		[]any{postID, 0, 1, userID}, 1)
	if err != nil {
		return Post{}, err
	}
	if len(items) == 0 {
		return Post{}, ErrNotFound
	}
	return items[0], nil
}

func (r *PostgresRepository) list(ctx context.Context, condition string, args []any, limit int) ([]Post, error) {
	sourceVisibleSQL := postVisibleToViewerFor("source_post", "$4")
	childVisibleSQL := postVisibleToViewerFor("child", "$4")
	query := `
		SELECT post.id, post.event_id, post.visibility, post.city, post.caption, post.created_at, post.repost_of_post_id,
			jsonb_build_object(
				'id', author.id,
				'username', author.username,
				'display_name', author.display_name,
				'photo_url', CASE WHEN author.avatar_media_id IS NULL THEN author.provider_photo_url ELSE '/api/v1/media/' || author.avatar_media_id::text || '/content' END,
				'equipped_decoration_code', author.equipped_decoration_code,
				'relationship_state', CASE
					WHEN author.id = $4 THEN 'self'
					WHEN EXISTS (
						SELECT 1 FROM user_blocks block
						WHERE block.blocker_id = $4 AND block.blocked_id = author.id
					) THEN 'blocked'
					WHEN EXISTS (
						SELECT 1 FROM friendships friendship
						WHERE friendship.user_low_id = LEAST($4, author.id)
							AND friendship.user_high_id = GREATEST($4, author.id)
					) THEN 'friend'
					WHEN EXISTS (
						SELECT 1 FROM friend_requests request
						WHERE request.requester_id = $4 AND request.addressee_id = author.id
					) THEN 'outgoing'
					WHEN EXISTS (
						SELECT 1 FROM friend_requests request
						WHERE request.requester_id = author.id AND request.addressee_id = $4
					) THEN 'incoming'
					ELSE 'stranger'
				END
			),
			COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', media.id,
					'mime_type', media.mime_type,
					'width', media.width,
					'height', media.height,
					'duration_ms', media.duration_ms,
					'url', '/api/v1/media/' || media.id::text || '/content'
				) ORDER BY link.position)
				FROM post_media link
				JOIN media_assets media ON media.id = link.media_id
				WHERE link.post_id = post.id
			), '[]'::jsonb),
			COALESCE((
				SELECT jsonb_agg(jsonb_build_object(
					'id', tagged.id,
					'username', tagged.username,
					'display_name', tagged.display_name,
					'photo_url', CASE WHEN tagged.avatar_media_id IS NULL THEN tagged.provider_photo_url ELSE '/api/v1/media/' || tagged.avatar_media_id::text || '/content' END,
					'equipped_decoration_code', tagged.equipped_decoration_code
				) ORDER BY tagged.display_name, tagged.id)
			FROM post_participant_tags tag
			JOIN users tagged ON tagged.id = tag.user_id
			WHERE tag.post_id = post.id
				AND (post.event_id IS NULL OR tagged.participant_visibility = 'participants' OR tagged.id = $4)
				AND NOT EXISTS (
						SELECT 1 FROM user_blocks block
						WHERE (block.blocker_id = $4 AND block.blocked_id = tagged.id)
							OR (block.blocker_id = tagged.id AND block.blocked_id = $4)
					)
			), '[]'::jsonb),
			(SELECT count(*) FROM post_likes likes WHERE likes.post_id = post.id),
			(SELECT count(*) FROM post_comments comments
			 WHERE comments.post_id = post.id AND comments.moderation_hidden_at IS NULL AND comment_safety_visible(comments.id,$4)
			 AND EXISTS (SELECT 1 FROM users comment_author WHERE comment_author.id = comments.author_user_id
				AND comment_author.moderation_suspended_at IS NULL)
			 AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $4 AND block.blocked_id = comments.author_user_id)
					OR (block.blocker_id = comments.author_user_id AND block.blocked_id = $4)
			 )),
			EXISTS (SELECT 1 FROM post_likes likes WHERE likes.post_id = post.id AND likes.user_id = $4),
			COALESCE(CASE
				WHEN post.repost_source_deleted THEN jsonb_build_object('unavailable', true)
				WHEN post.repost_of_post_id IS NULL THEN NULL
				WHEN source_post.id IS NULL
					OR NOT (` + sourceVisibleSQL + `)
					OR EXISTS (
						SELECT 1 FROM user_blocks block
						WHERE (block.blocker_id = $4 AND block.blocked_id = source_post.author_user_id)
							OR (block.blocker_id = source_post.author_user_id AND block.blocked_id = $4)
					)
				THEN jsonb_build_object('unavailable', true)
				ELSE jsonb_build_object(
					'unavailable', false,
					'id', source_post.id,
					'event_id', source_post.event_id,
					'visibility', source_post.visibility,
					'city', source_post.city,
					'author', jsonb_build_object(
						'id', source_author.id,
						'username', source_author.username,
						'display_name', source_author.display_name,
						'photo_url', CASE WHEN source_author.avatar_media_id IS NULL THEN source_author.provider_photo_url ELSE '/api/v1/media/' || source_author.avatar_media_id::text || '/content' END,
						'equipped_decoration_code', source_author.equipped_decoration_code
					),
					'caption', source_post.caption,
					'media', COALESCE((
						SELECT jsonb_agg(jsonb_build_object(
							'id', source_media.id,
							'mime_type', source_media.mime_type,
							'width', source_media.width,
							'height', source_media.height,
							'duration_ms', source_media.duration_ms,
							'url', '/api/v1/media/' || source_media.id::text || '/content'
						) ORDER BY source_link.position)
						FROM post_media source_link
						JOIN media_assets source_media ON source_media.id = source_link.media_id
						WHERE source_link.post_id = source_post.id
					), '[]'::jsonb),
					'created_at', source_post.created_at
				)
			END, 'null'::jsonb),
			(SELECT count(DISTINCT child.author_user_id) FROM posts child
			 WHERE child.repost_of_post_id = COALESCE(post.repost_of_post_id, post.id)
			   AND (` + childVisibleSQL + `)
			   AND NOT EXISTS (
					SELECT 1 FROM user_blocks block
					WHERE (block.blocker_id = $4 AND block.blocked_id = child.author_user_id)
						OR (block.blocker_id = child.author_user_id AND block.blocked_id = $4)
			   )),
			EXISTS (SELECT 1 FROM posts mine
				WHERE mine.author_user_id = $4
					AND mine.repost_of_post_id = COALESCE(post.repost_of_post_id, post.id)
					AND mine.moderation_hidden_at IS NULL)
		FROM posts post
		JOIN users author ON author.id = post.author_user_id
		LEFT JOIN posts source_post ON source_post.id = post.repost_of_post_id
		LEFT JOIN users source_author ON source_author.id = source_post.author_user_id
		WHERE ` + condition + `
			AND ` + strings.ReplaceAll(postVisibleToViewerSQL, "$1", "$4") + `
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = $4 AND block.blocked_id = post.author_user_id)
					OR (block.blocker_id = post.author_user_id AND block.blocked_id = $4)
			)
		ORDER BY post.id DESC
		LIMIT $3`
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list posts: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]Post, 0, limit)
	for rows.Next() {
		var item Post
		var authorJSON, mediaJSON, tagsJSON, repostJSON []byte
		if err := rows.Scan(&item.ID, &item.EventID, &item.Visibility, &item.City, &item.Caption, &item.CreatedAt, &item.RepostOfPostID,
			&authorJSON, &mediaJSON, &tagsJSON, &item.LikeCount, &item.CommentCount, &item.LikedByMe, &repostJSON, &item.RepostCount, &item.RepostedByMe); err != nil {
			return nil, fmt.Errorf("scan post: %w", err)
		}
		if err := json.Unmarshal(authorJSON, &item.Author); err != nil {
			return nil, fmt.Errorf("decode post author: %w", err)
		}
		if err := json.Unmarshal(mediaJSON, &item.Media); err != nil {
			return nil, fmt.Errorf("decode post media: %w", err)
		}
		if err := json.Unmarshal(tagsJSON, &item.Tagged); err != nil {
			return nil, fmt.Errorf("decode post tags: %w", err)
		}
		if err := json.Unmarshal(repostJSON, &item.Repost); err != nil {
			return nil, fmt.Errorf("decode repost source: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate posts: %w", err)
	}
	return items, nil
}
