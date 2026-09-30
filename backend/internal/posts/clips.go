package posts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ClipService shares the post repository so moderation and media visibility have one owner.
type ClipService struct {
	repository *PostgresRepository
	publisher  Publisher
}

func NewClipService(repository *PostgresRepository, publisher Publisher) *ClipService {
	return &ClipService{repository: repository, publisher: publisher}
}

type Clip struct {
	Post
	Following bool   `json:"following"`
	CoverMS   int    `json:"cover_ms"`
	Senders   []User `json:"senders"`
}
type ClipPage struct {
	Clips      []Clip  `json:"clips"`
	NextCursor *string `json:"next_cursor,omitempty"`
}

func validateClipMedia(ctx context.Context, tx *sql.Tx, userID int64, ids []int64) error {
	if len(ids) != 1 {
		return ErrInvalidMedia
	}
	var valid bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM media_assets WHERE id=$1 AND owner_user_id=$2
 AND clip_ready AND mime_type='video/mp4' AND duration_ms BETWEEN 1 AND 180000
 AND LEAST(width,height)<=480 AND GREATEST(width,height)<=854 AND byte_size<=41943040)`, ids[0], userID).Scan(&valid)
	if err != nil {
		return err
	}
	if !valid {
		return ErrInvalidMedia
	}
	return nil
}

func (s *ClipService) Get(ctx context.Context, userID, postID int64) (Clip, error) {
	if userID <= 0 || postID <= 0 {
		return Clip{}, ErrNotFound
	}
	posts, err := s.repository.ListByIDs(ctx, userID, []int64{postID})
	if err != nil {
		return Clip{}, err
	}
	if len(posts) != 1 {
		return Clip{}, ErrNotFound
	}
	decorated, err := s.decorate(ctx, userID, posts, "")
	if err != nil {
		return Clip{}, err
	}
	clip, ok := decorated[postID]
	if !ok {
		return Clip{}, ErrNotFound
	}
	return clip, nil
}

func (s *ClipService) Feed(ctx context.Context, userID int64, scope, cursor string, authorID int64) (ClipPage, error) {
	page := ClipPage{Clips: []Clip{}}
	if userID <= 0 || authorID < 0 || (scope != "for-you" && scope != "following" && scope != "inbox" && scope != "author") || (scope == "author" && authorID == 0) {
		return page, ErrInvalidPost
	}
	r := s.repository
	var token string
	position := 0
	if cursor == "" {
		var err error
		token, err = newSnapshotID()
		if err != nil {
			return page, err
		}
		// Keep the slate stable while feedback changes future sessions and live visibility is rechecked below.
		_, err = r.db.ExecContext(ctx, `WITH recent_likes AS MATERIALIZED (
   SELECT liked.post_id FROM post_likes liked JOIN clips clip ON clip.post_id=liked.post_id
   WHERE liked.user_id=$1 AND liked.created_at>=now()-interval '90 days'
   ORDER BY liked.created_at DESC LIMIT 50
  ), peers AS MATERIALIZED (
   SELECT liked.user_id,count(*) AS overlap FROM recent_likes seed
   JOIN post_likes liked ON liked.post_id=seed.post_id
   JOIN users peer ON peer.id=liked.user_id AND peer.moderation_suspended_at IS NULL
   WHERE liked.user_id<>$1
    AND EXISTS(SELECT 1 FROM user_identities identity WHERE identity.user_id=liked.user_id AND identity.status='verified')
    AND NOT EXISTS(SELECT 1 FROM user_blocks block WHERE
     (block.blocker_id=$1 AND block.blocked_id=liked.user_id) OR (block.blocker_id=liked.user_id AND block.blocked_id=$1))
   GROUP BY liked.user_id ORDER BY overlap DESC,liked.user_id LIMIT 35
  ), watched_authors AS (
   SELECT post.author_user_id,
    GREATEST(-36,LEAST(36,sum(CASE WHEN feedback.hidden THEN -16
     WHEN media.duration_ms>0 AND feedback.watched_ms*4>=media.duration_ms*3 THEN 12
     WHEN media.duration_ms>0 AND feedback.watched_ms*5<media.duration_ms THEN -5
     ELSE 2 END))) AS affinity
   FROM clip_feedback feedback JOIN posts post ON post.id=feedback.post_id
   JOIN post_media link ON link.post_id=post.id AND link.position=0
   JOIN media_assets media ON media.id=link.media_id
   WHERE feedback.user_id=$1 AND feedback.updated_at>=now()-interval '90 days'
   GROUP BY post.author_user_id
  ), liked_authors AS (
   SELECT post.author_user_id,LEAST(24,count(*)*6) AS affinity
   FROM post_likes liked JOIN posts post ON post.id=liked.post_id
   JOIN clips clip ON clip.post_id=post.id
   WHERE liked.user_id=$1 AND liked.created_at>=now()-interval '90 days'
   GROUP BY post.author_user_id
  ), candidates AS MATERIALIZED (
   SELECT post.id,post.author_user_id,post.created_at,
    (SELECT max(id) FROM clip_shares share WHERE share.post_id=post.id AND share.recipient_id=$1 AND share.recipient_deleted_at IS NULL) AS share_order
   FROM clips clip JOIN posts post ON post.id=clip.post_id JOIN users viewer ON viewer.id=$1
   LEFT JOIN user_follows follow ON follow.follower_id=$1 AND follow.followed_id=post.author_user_id
   LEFT JOIN clip_feedback feedback ON feedback.user_id=$1 AND feedback.post_id=post.id
   WHERE `+postVisibleToViewerSQL+` AND viewer.moderation_suspended_at IS NULL
    AND EXISTS(SELECT 1 FROM user_identities identity WHERE identity.user_id=post.author_user_id AND identity.status='verified')
    AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=post.author_user_id) OR (blocked_id=$1 AND blocker_id=post.author_user_id))
    AND ($2<>'for-you' OR NOT COALESCE(feedback.hidden,false))
    AND ($2<>'following' OR follow.followed_id IS NOT NULL)
    AND ($2<>'author' OR post.author_user_id=$3)
    AND ($2<>'inbox' OR EXISTS(SELECT 1 FROM clip_shares share JOIN friendships f ON f.user_low_id=LEAST(share.sender_id,$1) AND f.user_high_id=GREATEST(share.sender_id,$1)
     JOIN users sender ON sender.id=share.sender_id AND sender.moderation_suspended_at IS NULL
     WHERE share.recipient_id=$1 AND share.post_id=post.id AND share.recipient_deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=share.sender_id) OR (blocked_id=$1 AND blocker_id=share.sender_id))))
   ORDER BY post.id DESC LIMIT 2000
  ), peer_support AS (
   SELECT liked.post_id,LEAST(20,sum(peers.overlap)*3) AS affinity
   FROM peers JOIN post_likes liked ON liked.user_id=peers.user_id
   JOIN candidates candidate ON candidate.id=liked.post_id GROUP BY liked.post_id
  ), scored AS (
   SELECT candidate.*,
    (CASE WHEN follow.followed_id IS NOT NULL THEN 22 ELSE 0 END
     + COALESCE(watched.affinity,0)+COALESCE(liked.affinity,0)+COALESCE(support.affinity,0)
     + CASE WHEN lower(post.city)=lower(viewer.city) AND viewer.city<>'' THEN 3 ELSE 0 END
     + CASE WHEN EXISTS(SELECT 1 FROM clip_shares share JOIN friendships friend
       ON friend.user_low_id=LEAST($1::bigint,share.sender_id)
       AND friend.user_high_id=GREATEST($1::bigint,share.sender_id)
       WHERE share.post_id=candidate.id AND share.recipient_id=$1 AND share.recipient_deleted_at IS NULL) THEN 18 ELSE 0 END
     + CASE WHEN post.created_at>=now()-interval '1 day' THEN 16
       WHEN post.created_at>=now()-interval '7 days' THEN 9
       WHEN post.created_at>=now()-interval '30 days' THEN 3 ELSE 0 END
     - CASE WHEN feedback.watched_ms>0 THEN 38 ELSE 0 END) AS score
   FROM candidates candidate JOIN posts post ON post.id=candidate.id
   JOIN users viewer ON viewer.id=$1
   LEFT JOIN user_follows follow ON follow.follower_id=$1 AND follow.followed_id=candidate.author_user_id
   LEFT JOIN clip_feedback feedback ON feedback.user_id=$1 AND feedback.post_id=candidate.id
   LEFT JOIN watched_authors watched ON watched.author_user_id=candidate.author_user_id
   LEFT JOIN liked_authors liked ON liked.author_user_id=candidate.author_user_id
   LEFT JOIN peer_support support ON support.post_id=candidate.id
  ), ranked AS (SELECT *,row_number() OVER(PARTITION BY author_user_id ORDER BY score DESC,id DESC) AS author_rank FROM scored), ordered AS (
   SELECT id FROM ranked ORDER BY
    CASE WHEN $2='for-you' THEN ranking_priority(score-LEAST(3,author_rank-1)*18,$1,id,'clips',current_date,12) END DESC NULLS LAST,
    CASE WHEN $2='inbox' THEN share_order END DESC NULLS LAST,id DESC LIMIT 400
  ) INSERT INTO clip_feed_sessions(id,user_id,scope,author_id,post_ids)
   SELECT $4,$1,$2,$3,COALESCE(array_agg(id),'{}'::bigint[]) FROM ordered`, userID, scope, authorID, token)
		if err != nil {
			return page, fmt.Errorf("create clip feed: %w", err)
		}
		// Expired sessions are bounded transient state; no timer or polling worker is needed.
		_, _ = r.db.ExecContext(ctx, `DELETE FROM clip_feed_sessions WHERE expires_at<now()`)
	} else {
		var err error
		token, position, err = parseRankCursor(cursor, 400)
		if err != nil {
			return page, err
		}
	}
	var idsJSON string
	err := r.db.QueryRowContext(ctx, `SELECT array_to_json(post_ids)::text FROM clip_feed_sessions WHERE id=$1 AND user_id=$2 AND scope=$3 AND author_id=$4 AND expires_at>now()`, token, userID, scope, authorID).Scan(&idsJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return page, ErrInvalidRankCursor
	}
	if err != nil {
		return page, err
	}
	ids, err := decodeClipIDs(idsJSON)
	if err != nil {
		return page, err
	}
	for position < len(ids) && len(page.Clips) < 12 {
		end := min(position+12-len(page.Clips), len(ids))
		batch := ids[position:end]
		position = end
		visible, err := r.ListByIDs(ctx, userID, batch)
		if err != nil {
			return page, err
		}
		decorated, err := s.decorate(ctx, userID, visible, scope)
		if err != nil {
			return page, err
		}
		for _, id := range batch {
			if clip, ok := decorated[id]; ok {
				page.Clips = append(page.Clips, clip)
			}
		}
	}
	if position < len(ids) {
		next := fmt.Sprintf("%s:%d", token, position)
		page.NextCursor = &next
	}
	return page, nil
}
