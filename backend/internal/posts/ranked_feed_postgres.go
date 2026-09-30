package posts

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

var ErrInvalidRankCursor = errors.New("invalid ranked feed cursor")

const rankedFeedSnapshotSize = 500
const rankedFeedBatchSize = 80

func (r *PostgresRepository) RankedFeed(ctx context.Context, viewerID int64, cursor string, limit int) ([]Post, *string, error) {
	if limit <= 0 || limit > 50 || viewerID <= 0 {
		return nil, nil, ErrInvalidPost
	}
	var snapshotID string
	position := 0
	if cursor == "" {
		var err error
		snapshotID, err = r.createRankedFeedSnapshot(ctx, viewerID)
		if err != nil {
			return nil, nil, err
		}
	} else {
		var err error
		snapshotID, position, err = parseRankCursor(cursor, rankedFeedSnapshotSize)
		if err != nil {
			return nil, nil, err
		}
	}
	var available bool
	if err := r.db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM ranked_feed_snapshots
		WHERE id=$1 AND viewer_user_id=$2 AND expires_at>now())`, snapshotID, viewerID).Scan(&available); err != nil {
		return nil, nil, fmt.Errorf("authorize ranked feed snapshot: %w", err)
	}
	if !available {
		return nil, nil, ErrInvalidRankCursor
	}

	posts := make([]Post, 0, limit)
	for len(posts) < limit {
		rows, err := r.db.QueryContext(ctx, `SELECT position,post_id FROM ranked_feed_items
			WHERE snapshot_id=$1 AND position >= $2 ORDER BY position LIMIT $3`, snapshotID, position, rankedFeedBatchSize)
		if err != nil {
			return nil, nil, fmt.Errorf("load ranked feed positions: %w", err)
		}
		ids := []int64{}
		positions := []int{}
		for rows.Next() {
			var id int64
			var ordinal int
			if err := rows.Scan(&ordinal, &id); err != nil {
				_ = rows.Close()
				return nil, nil, fmt.Errorf("scan ranked feed position: %w", err)
			}
			positions = append(positions, ordinal)
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return nil, nil, fmt.Errorf("iterate ranked feed positions: %w", err)
		}
		_ = rows.Close()
		if len(ids) == 0 {
			break
		}

		visible, err := r.list(ctx, `post.id = ANY($1::bigint[]) AND $2::bigint = 0
			AND NOT EXISTS (SELECT 1 FROM feed_feedback feedback
				WHERE feedback.user_id=$4 AND feedback.post_id=post.id)
			AND `+socialPostCondition,
			[]any{ids, 0, len(ids), viewerID}, len(ids))
		if err != nil {
			return nil, nil, err
		}
		byID := make(map[int64]Post, len(visible))
		for _, post := range visible {
			byID[post.ID] = post
		}
		for index, id := range ids {
			position = positions[index] + 1
			if post, ok := byID[id]; ok {
				posts = append(posts, post)
				if len(posts) == limit {
					break
				}
			}
		}
		if len(ids) < rankedFeedBatchSize {
			break
		}
	}
	var hasMore bool
	if err := r.db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM ranked_feed_items WHERE snapshot_id=$1 AND position >= $2)`, snapshotID, position).Scan(&hasMore); err != nil {
		return nil, nil, fmt.Errorf("check ranked feed continuation: %w", err)
	}
	if !hasMore {
		return posts, nil, nil
	}
	next := fmt.Sprintf("%s:%d", snapshotID, position)
	return posts, &next, nil
}

func parseRankCursor(cursor string, maxPosition int) (string, int, error) {
	parts := strings.Split(cursor, ":")
	if len(parts) != 2 || len(parts[0]) != 32 {
		return "", 0, ErrInvalidRankCursor
	}
	if _, err := hex.DecodeString(parts[0]); err != nil {
		return "", 0, ErrInvalidRankCursor
	}
	position, err := strconv.Atoi(parts[1])
	if err != nil || position < 0 || position > maxPosition {
		return "", 0, ErrInvalidRankCursor
	}
	return parts[0], position, nil
}

func (r *PostgresRepository) createRankedFeedSnapshot(ctx context.Context, viewerID int64) (string, error) {
	id, err := newSnapshotID()
	if err != nil {
		return "", err
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", fmt.Errorf("begin ranked feed snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT INTO ranked_feed_snapshots(id,viewer_user_id,expires_at)
		VALUES($1,$2,now()+interval '30 minutes')`, id, viewerID); err != nil {
		return "", fmt.Errorf("create ranked feed snapshot: %w", err)
	}

	ranked := `
		WITH recent_likes AS MATERIALIZED (
			SELECT post.author_user_id, likes.post_id
			FROM post_likes likes JOIN posts post ON post.id=likes.post_id
			WHERE likes.user_id=$1 AND likes.created_at>=now()-interval '90 days'
			ORDER BY likes.created_at DESC LIMIT 60
		), recent_comments AS MATERIALIZED (
			SELECT post.author_user_id
			FROM post_comments comment JOIN posts post ON post.id=comment.post_id
			WHERE comment.author_user_id=$1 AND comment.created_at>=now()-interval '90 days'
			ORDER BY comment.created_at DESC LIMIT 60
		), author_affinity AS (
			SELECT author_user_id,LEAST(48,sum(weight)) AS strength FROM (
				SELECT author_user_id,8 AS weight FROM recent_likes
				UNION ALL SELECT author_user_id,12 AS weight FROM recent_comments
			) actions GROUP BY author_user_id
		), author_negative AS (
			SELECT post.author_user_id,LEAST(3,count(*)) AS count
			FROM feed_feedback feedback JOIN posts post ON post.id=feedback.post_id
			WHERE feedback.user_id=$1 AND feedback.hidden_at>=now()-interval '90 days'
			GROUP BY post.author_user_id
		), peers AS MATERIALIZED (
			SELECT likes.user_id,count(*) AS overlap
			FROM recent_likes seed JOIN post_likes likes ON likes.post_id=seed.post_id
			JOIN users peer ON peer.id=likes.user_id AND peer.moderation_suspended_at IS NULL
			WHERE likes.user_id<>$1 AND EXISTS (SELECT 1 FROM user_identities identity
				WHERE identity.user_id=likes.user_id AND identity.status='verified')
				AND NOT EXISTS (SELECT 1 FROM user_blocks block
					WHERE (block.blocker_id=$1 AND block.blocked_id=likes.user_id)
						OR (block.blocker_id=likes.user_id AND block.blocked_id=$1))
			GROUP BY likes.user_id ORDER BY overlap DESC,likes.user_id LIMIT 40
		), candidate AS MATERIALIZED (
			SELECT post.id,post.author_user_id,post.event_id,post.city,
				post.created_at,post.repost_of_post_id
			FROM posts post JOIN users author ON author.id=post.author_user_id
			WHERE author.moderation_suspended_at IS NULL
				AND post.moderation_hidden_at IS NULL
				AND ` + socialPostCondition + `
				AND EXISTS (SELECT 1 FROM user_identities identity
					WHERE identity.user_id=post.author_user_id AND identity.status='verified')
				AND ` + postVisibleToViewerSQL + `
				AND NOT EXISTS (SELECT 1 FROM user_blocks block
					WHERE (block.blocker_id=$1 AND block.blocked_id=post.author_user_id)
						OR (block.blocker_id=post.author_user_id AND block.blocked_id=$1))
				AND NOT EXISTS (SELECT 1 FROM feed_feedback feedback
					WHERE feedback.user_id=$1 AND feedback.post_id=post.id)
			ORDER BY post.id DESC LIMIT 1500
		), peer_support AS (
			SELECT likes.post_id,LEAST(24,sum(peers.overlap)*3) AS strength
			FROM peers JOIN post_likes likes ON likes.user_id=peers.user_id
			JOIN candidate ON candidate.id=likes.post_id
			GROUP BY likes.post_id
		), scored AS (
			SELECT candidate.*,
				(CASE WHEN candidate.author_user_id=$1 THEN 28 ELSE 0 END)
				+ (CASE WHEN EXISTS (SELECT 1 FROM friendships friendship
					WHERE friendship.user_low_id=LEAST($1::bigint,candidate.author_user_id)
						AND friendship.user_high_id=GREATEST($1::bigint,candidate.author_user_id)) THEN 26 ELSE 0 END)
				+ (CASE WHEN candidate.event_id IS NOT NULL AND EXISTS (SELECT 1 FROM event_participants participant
					WHERE participant.user_id=$1 AND participant.event_id=candidate.event_id) THEN 22 ELSE 0 END)
				+ (CASE WHEN EXISTS (SELECT 1 FROM post_participant_tags tag
					WHERE tag.post_id=candidate.id AND tag.user_id=$1) THEN 24 ELSE 0 END)
				+ COALESCE(affinity.strength,0) + COALESCE(support.strength,0)
				+ (CASE WHEN EXISTS (SELECT 1 FROM post_likes mine
					WHERE mine.post_id=candidate.id AND mine.user_id=$1) THEN 12 ELSE 0 END)
				+ (CASE WHEN EXISTS (SELECT 1 FROM post_comments mine
					WHERE mine.post_id=candidate.id AND mine.author_user_id=$1
						AND mine.moderation_hidden_at IS NULL) THEN 14 ELSE 0 END)
				+ (CASE WHEN EXISTS (SELECT 1 FROM post_likes likes JOIN friendships friend
					ON friend.user_low_id=LEAST($1::bigint,likes.user_id)
						AND friend.user_high_id=GREATEST($1::bigint,likes.user_id)
					WHERE likes.post_id=candidate.id) THEN 9 ELSE 0 END)
				+ (CASE WHEN candidate.city<>'' AND EXISTS (SELECT 1 FROM users viewer
					WHERE viewer.id=$1 AND viewer.city<>'' AND lower(viewer.city)=lower(candidate.city)) THEN 5 ELSE 0 END)
				+ (CASE WHEN EXISTS (SELECT 1 FROM user_interests mine
					JOIN user_interests author_interest ON lower(author_interest.interest)=lower(mine.interest)
					WHERE mine.user_id=$1 AND author_interest.user_id=candidate.author_user_id) THEN 3 ELSE 0 END)
				+ (CASE WHEN candidate.created_at>=now()-interval '1 day' THEN 18
					WHEN candidate.created_at>=now()-interval '7 days' THEN 10
					WHEN candidate.created_at>=now()-interval '30 days' THEN 3 ELSE 0 END)
				+ LEAST(12,4*(SELECT count(DISTINCT comment.author_user_id)
					FROM post_comments comment WHERE comment.post_id=candidate.id
					AND comment.moderation_hidden_at IS NULL AND comment_safety_visible(comment.id,$1)))
				- 12*COALESCE(negative.count,0)
				- (CASE WHEN candidate.repost_of_post_id IS NOT NULL THEN 5 ELSE 0 END) AS score
			FROM candidate
			LEFT JOIN author_affinity affinity ON affinity.author_user_id=candidate.author_user_id
			LEFT JOIN author_negative negative ON negative.author_user_id=candidate.author_user_id
			LEFT JOIN peer_support support ON support.post_id=candidate.id
		), diversified AS (
			SELECT scored.*,
				row_number() OVER (PARTITION BY author_user_id ORDER BY score DESC,created_at DESC,id DESC) AS author_position,
				row_number() OVER (PARTITION BY event_id ORDER BY score DESC,created_at DESC,id DESC) AS event_position
			FROM scored
		), ordered AS (
			SELECT id, row_number() OVER (
				ORDER BY ranking_priority(
					score-LEAST(2,author_position-1)*18
					-CASE WHEN event_id IS NOT NULL THEN LEAST(2,event_position-1)*8 ELSE 0 END,
					$1,id,'social_feed',current_date,8) DESC,
					created_at DESC,id DESC) - 1 AS position
			FROM diversified
		)
		INSERT INTO ranked_feed_items(snapshot_id,position,post_id)
		SELECT $2,position,id FROM ordered WHERE position < 500`
	if _, err := tx.ExecContext(ctx, ranked, viewerID, id); err != nil {
		return "", fmt.Errorf("rank feed posts: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit ranked feed snapshot: %w", err)
	}
	return id, nil
}

func newSnapshotID() (string, error) {
	var randomID [16]byte
	if _, err := rand.Read(randomID[:]); err != nil {
		return "", fmt.Errorf("generate ranking snapshot ID: %w", err)
	}
	return hex.EncodeToString(randomID[:]), nil
}
