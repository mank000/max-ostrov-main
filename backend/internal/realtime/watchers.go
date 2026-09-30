package realtime

import (
	"context"
	"time"
)

func (b *Broker) Watch(ctx context.Context, userID int64, postIDs []int64) {
	if b.relay == nil || len(postIDs) == 0 || len(postIDs) > 50 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_, err := b.relay.db.ExecContext(ctx, `
  INSERT INTO realtime_post_watchers (post_id, user_id, seen_at)
  SELECT posts.id, $1, now() FROM posts WHERE posts.id = ANY($2::bigint[])
  ON CONFLICT (post_id, user_id) DO UPDATE SET seen_at = EXCLUDED.seen_at
  WHERE realtime_post_watchers.seen_at < now() - interval '10 seconds'`, userID, postIDs)
	if err != nil && ctx.Err() == nil {
		b.relay.logger.Warn("register post watchers", "error", err)
	}
}

func (b *Broker) InterestedUsers(ctx context.Context, postID int64) ([]int64, error) {
	if b.relay == nil {
		return b.Users(), nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	rows, err := b.relay.db.QueryContext(ctx, `SELECT user_id FROM realtime_post_watchers
  WHERE post_id = $1 AND seen_at > now() - interval '2 minutes'`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		users = append(users, id)
	}
	return users, rows.Err()
}
