package posts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type ClipMessage struct {
	ID          int64      `json:"id"`
	SenderID    int64      `json:"sender_id"`
	RecipientID int64      `json:"recipient_id"`
	Peer        User       `json:"peer"`
	Clip        Clip       `json:"clip"`
	CreatedAt   time.Time  `json:"created_at"`
	ReadAt      *time.Time `json:"read_at,omitempty"`
	ReplyEmoji  *string    `json:"reply_emoji,omitempty"`
	RepliedAt   *time.Time `json:"replied_at,omitempty"`
	ReplyReadAt *time.Time `json:"reply_read_at,omitempty"`
}

func (s *ClipService) Messages(ctx context.Context, viewer int64) ([]ClipMessage, error) {
	rows, err := s.repository.db.QueryContext(ctx, `SELECT share.id,share.post_id,share.sender_id,share.recipient_id,
  peer.id,peer.display_name,COALESCE(CASE WHEN peer.avatar_media_id IS NULL THEN peer.provider_photo_url ELSE '/api/v1/media/' || peer.avatar_media_id::text || '/content' END,''),share.created_at,share.read_at,share.reply_emoji,share.replied_at,share.reply_read_at
 FROM clip_shares share JOIN users peer ON peer.id=CASE WHEN share.sender_id=$1 THEN share.recipient_id ELSE share.sender_id END
 JOIN friendships f ON f.user_low_id=LEAST(share.sender_id,share.recipient_id) AND f.user_high_id=GREATEST(share.sender_id,share.recipient_id)
 WHERE ((share.sender_id=$1 AND share.sender_deleted_at IS NULL)
 OR (share.recipient_id=$1 AND share.recipient_deleted_at IS NULL))
 AND peer.moderation_suspended_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM user_blocks block WHERE (block.blocker_id=share.sender_id AND block.blocked_id=share.recipient_id)
 OR (block.blocker_id=share.recipient_id AND block.blocked_id=share.sender_id))
 ORDER BY GREATEST(share.created_at,COALESCE(share.replied_at,share.created_at)) DESC,share.id DESC LIMIT 200`, viewer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]ClipMessage, 0)
	ids := make([]int64, 0)
	for rows.Next() {
		var item ClipMessage
		var postID int64
		if err := rows.Scan(&item.ID, &postID, &item.SenderID, &item.RecipientID, &item.Peer.ID, &item.Peer.DisplayName,
			&item.Peer.PhotoURL, &item.CreatedAt, &item.ReadAt, &item.ReplyEmoji, &item.RepliedAt, &item.ReplyReadAt); err != nil {
			return nil, err
		}
		item.Clip.Post.ID = postID
		items = append(items, item)
		ids = append(ids, postID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return items, nil
	}
	posts, err := s.repository.ListByIDs(ctx, viewer, ids)
	if err != nil {
		return nil, err
	}
	clips, err := s.decorate(ctx, viewer, posts, "")
	if err != nil {
		return nil, err
	}
	visible := make([]ClipMessage, 0, len(items))
	for _, item := range items {
		if clip, ok := clips[item.Clip.Post.ID]; ok {
			item.Clip = clip
			visible = append(visible, item)
		}
	}
	return visible, nil
}

func (s *ClipService) ReadInbox(ctx context.Context, viewer int64) error {
	if viewer <= 0 {
		return ErrInvalidPost
	}
	_, err := s.repository.db.ExecContext(ctx, `UPDATE clip_shares share
 SET read_at=COALESCE(read_at,now())
 WHERE share.recipient_id=$1 AND share.read_at IS NULL
 AND share.recipient_deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM friendships f
   WHERE f.user_low_id=LEAST(share.sender_id,share.recipient_id)
   AND f.user_high_id=GREATEST(share.sender_id,share.recipient_id))
 AND NOT EXISTS(SELECT 1 FROM user_blocks b
   WHERE (b.blocker_id=share.sender_id AND b.blocked_id=share.recipient_id)
   OR (b.blocker_id=share.recipient_id AND b.blocked_id=share.sender_id))`, viewer)
	return err
}

func (s *ClipService) ReadMessages(ctx context.Context, viewer, peer int64) error {
	if viewer <= 0 || peer <= 0 || viewer == peer {
		return ErrInvalidPost
	}
	_, err := s.repository.db.ExecContext(ctx, `UPDATE clip_shares SET
 read_at=CASE WHEN recipient_id=$1 THEN COALESCE(read_at,now()) ELSE read_at END,
 reply_read_at=CASE WHEN sender_id=$1 AND reply_emoji IS NOT NULL THEN COALESCE(reply_read_at,now()) ELSE reply_read_at END
 WHERE ((recipient_id=$1 AND sender_id=$2 AND recipient_deleted_at IS NULL)
 OR (sender_id=$1 AND recipient_id=$2 AND sender_deleted_at IS NULL))
 AND EXISTS(SELECT 1 FROM friendships f WHERE f.user_low_id=LEAST($1::bigint,$2::bigint) AND f.user_high_id=GREATEST($1::bigint,$2::bigint))`, viewer, peer)
	return err
}

var clipEmojis = map[string]bool{"❤️": true, "😂": true, "🔥": true, "😍": true, "👏": true, "😮": true, "👍": true, "🥰": true}

func (s *ClipService) React(ctx context.Context, viewer, shareID int64, emoji string) error {
	if emoji != "" && !clipEmojis[emoji] {
		return ErrInvalidPost
	}
	var sender int64
	err := s.repository.db.QueryRowContext(ctx, `UPDATE clip_shares share SET
 reply_emoji=NULLIF($3,''),
 replied_at=CASE WHEN $3='' THEN NULL ELSE now() END,
 reply_read_at=NULL,
 read_at=COALESCE(read_at,now())
 WHERE share.id=$2 AND share.recipient_id=$1
 AND share.recipient_deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM posts post WHERE post.id=share.post_id AND `+postVisibleToViewerSQL+`)
 AND EXISTS(SELECT 1 FROM friendships f WHERE f.user_low_id=LEAST(share.sender_id,share.recipient_id) AND f.user_high_id=GREATEST(share.sender_id,share.recipient_id))
 AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=share.sender_id AND b.blocked_id=share.recipient_id)
 OR (b.blocker_id=share.recipient_id AND b.blocked_id=share.sender_id))
 RETURNING share.sender_id`, viewer, shareID, emoji).Scan(&sender)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err == nil && s.publisher != nil {
		s.publisher.Publish(sender, "clip.reacted", map[string]int64{"share_id": shareID})
	}
	return err
}

func (s *ClipService) DeleteMessage(ctx context.Context, viewer, shareID int64, forEveryone bool) error {
	if viewer <= 0 || shareID <= 0 {
		return ErrInvalidPost
	}
	if forEveryone {
		var recipient int64
		err := s.repository.db.QueryRowContext(ctx, `DELETE FROM clip_shares
 WHERE id=$2 AND sender_id=$1
 RETURNING recipient_id`, viewer, shareID).Scan(&recipient)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if s.publisher != nil {
			s.publisher.Publish(recipient, "clip.message_deleted", map[string]int64{"share_id": shareID})
		}
		return nil
	}
	result, err := s.repository.db.ExecContext(ctx, `UPDATE clip_shares SET
 sender_deleted_at=CASE WHEN sender_id=$1 THEN COALESCE(sender_deleted_at,now()) ELSE sender_deleted_at END,
 recipient_deleted_at=CASE WHEN recipient_id=$1 THEN COALESCE(recipient_deleted_at,now()) ELSE recipient_deleted_at END
 WHERE id=$2 AND ((sender_id=$1 AND sender_deleted_at IS NULL)
 OR (recipient_id=$1 AND recipient_deleted_at IS NULL))`, viewer, shareID)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated == 0 {
		return ErrNotFound
	}
	return nil
}

func decodeClipIDs(raw string) ([]int64, error) {
	var ids []int64
	err := json.Unmarshal([]byte(raw), &ids)
	return ids, err
}
func (s *ClipService) decorate(ctx context.Context, viewer int64, posts []Post, scope string) (map[int64]Clip, error) {
	result := make(map[int64]Clip, len(posts))
	ids := make([]int64, 0, len(posts))
	byID := make(map[int64]Post, len(posts))
	for _, p := range posts {
		ids = append(ids, p.ID)
		byID[p.ID] = p
	}
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.repository.db.QueryContext(ctx, `SELECT c.post_id,c.cover_ms,(follow.followed_id IS NOT NULL)
 FROM clips c JOIN posts p ON p.id=c.post_id
 LEFT JOIN user_follows follow ON follow.follower_id=$1 AND follow.followed_id=p.author_user_id
 WHERE c.post_id=ANY($2::bigint[])
 AND ($3<>'following' OR follow.followed_id IS NOT NULL)
 AND ($3<>'for-you' OR NOT EXISTS(SELECT 1 FROM clip_feedback WHERE user_id=$1 AND post_id=c.post_id AND hidden))`, viewer, ids, scope)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var c Clip
		if err := rows.Scan(&id, &c.CoverMS, &c.Following); err != nil {
			rows.Close()
			return nil, err
		}
		c.Post = byID[id]
		c.Senders = []User{}
		result[id] = c
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if scope != "inbox" {
		return result, nil
	}
	rows, err = s.repository.db.QueryContext(ctx, `SELECT share.post_id,sender.id,sender.display_name FROM clip_shares share
 JOIN users sender ON sender.id=share.sender_id AND sender.moderation_suspended_at IS NULL
 JOIN friendships f ON f.user_low_id=LEAST($1,sender.id) AND f.user_high_id=GREATEST($1,sender.id)
 WHERE share.recipient_id=$1 AND share.post_id=ANY($2::bigint[])
 AND share.recipient_deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=sender.id) OR (blocked_id=$1 AND blocker_id=sender.id))
 ORDER BY share.id DESC`, viewer, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var user User
		if err := rows.Scan(&id, &user.ID, &user.DisplayName); err != nil {
			return nil, err
		}
		if c, ok := result[id]; ok && len(c.Senders) < 20 {
			c.Senders = append(c.Senders, user)
			result[id] = c
		}
	}
	for id, c := range result {
		if len(c.Senders) == 0 {
			delete(result, id)
		}
	}
	return result, rows.Err()
}
func (s *ClipService) Share(ctx context.Context, viewer, postID, recipient int64) error {
	if recipient <= 0 || recipient == viewer {
		return ErrInvalidPost
	}
	// Recheck both readers and the live friendship on every delivery. Delivery has no message body.
	visible, err := s.repository.VisibleViewers(ctx, postID, []int64{viewer, recipient})
	if err != nil {
		return err
	}
	if len(visible) != 2 {
		return ErrNotFound
	}
	var shareID int64
	err = s.repository.db.QueryRowContext(ctx, `INSERT INTO clip_shares(post_id,sender_id,recipient_id)
 SELECT c.post_id,$1,$3 FROM clips c JOIN friendships f ON f.user_low_id=LEAST($1::bigint,$3::bigint) AND f.user_high_id=GREATEST($1::bigint,$3::bigint)
 WHERE c.post_id=$2 AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$3) OR (blocker_id=$3 AND blocked_id=$1))
 ON CONFLICT(post_id,sender_id,recipient_id) DO UPDATE SET
 sender_deleted_at=NULL,
 recipient_deleted_at=NULL,
 created_at=now(),
 read_at=NULL,
 reply_emoji=NULL,
 replied_at=NULL,
 reply_read_at=NULL
 WHERE clip_shares.sender_deleted_at IS NOT NULL OR clip_shares.recipient_deleted_at IS NOT NULL
 RETURNING id`, viewer, postID, recipient).Scan(&shareID)
	if errors.Is(err, sql.ErrNoRows) {
		var exists bool
		if lookupErr := s.repository.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM clip_shares WHERE post_id=$1 AND sender_id=$2 AND recipient_id=$3)`, postID, viewer, recipient).Scan(&exists); lookupErr != nil {
			return lookupErr
		}
		if exists {
			return nil
		}
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if s.publisher != nil {
		s.publisher.Publish(recipient, "clip.shared", map[string]int64{"post_id": postID})
	}
	return nil
}
func (s *ClipService) Feedback(ctx context.Context, viewer, postID int64, watched int, hidden bool) error {
	if watched < 0 || watched > 180000 {
		return ErrInvalidPost
	}
	p, err := s.repository.Get(ctx, viewer, postID)
	if err != nil {
		return err
	}
	if len(p.Media) == 0 {
		return ErrInvalidMedia
	}
	watched = min(watched, p.Media[0].DurationMS)
	result, err := s.repository.db.ExecContext(ctx, `INSERT INTO clip_feedback(user_id,post_id,watched_ms,hidden)
 SELECT $1,post_id,$3,$4 FROM clips WHERE post_id=$2
 ON CONFLICT(user_id,post_id) DO UPDATE SET watched_ms=GREATEST(clip_feedback.watched_ms,EXCLUDED.watched_ms),hidden=clip_feedback.hidden OR EXCLUDED.hidden,updated_at=now()`, viewer, postID, watched, hidden)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return ErrNotFound
	}
	return err
}
func (s *ClipService) Cover(ctx context.Context, viewer, postID int64, coverMS int) error {
	result, err := s.repository.db.ExecContext(ctx, `UPDATE clips SET cover_ms=$3 FROM posts p,post_media pm,media_assets m
 WHERE clips.post_id=$2 AND p.id=clips.post_id AND p.author_user_id=$1 AND pm.post_id=p.id AND m.id=pm.media_id AND $3>=0 AND $3<m.duration_ms`, viewer, postID, coverMS)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n == 0 {
		return ErrInvalidPost
	}
	return err
}
