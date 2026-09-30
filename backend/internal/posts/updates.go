package posts

import (
	"context"
	"log/slog"
)

const maxUpdateIDs = 50

type Change struct {
	PostID    int64 `json:"post_id"`
	CommentID int64 `json:"comment_id,omitempty"`
}

func (s *Service) ListByIDs(ctx context.Context, userID int64, ids []int64) ([]Post, error) {
	if userID <= 0 || len(ids) == 0 || len(ids) > maxUpdateIDs || !uniqueIDs(ids, 0) {
		return nil, ErrInvalidPost
	}
	items, err := s.repository.ListByIDs(ctx, userID, ids)
	if err == nil {
		if watcher, ok := s.publisher.(interface {
			Watch(context.Context, int64, []int64)
		}); ok {
			visible := make([]int64, 0, len(items))
			for _, post := range items {
				visible = append(visible, post.ID)
			}
			watcher.Watch(ctx, userID, visible)
		}
	}
	return items, err
}

func (s *Service) CommentsByIDs(ctx context.Context, userID, postID int64, ids []int64) ([]Comment, error) {
	if userID <= 0 || postID <= 0 || len(ids) == 0 || len(ids) > maxUpdateIDs || !uniqueIDs(ids, 0) {
		return nil, ErrInvalidComment
	}
	return s.repository.CommentsByIDs(ctx, userID, postID, ids)
}

func (s *Service) viewers(ctx context.Context, postID int64) []int64 {
	if s.publisher == nil {
		return nil
	}
	var ids []int64
	if watcher, ok := s.publisher.(interface {
		InterestedUsers(context.Context, int64) ([]int64, error)
	}); ok {
		var err error
		ids, err = watcher.InterestedUsers(ctx, postID)
		if err != nil {
			slog.WarnContext(ctx, "load post watchers", "error", err)
		}
	} else {
		ids = s.publisher.Users()
	}
	if len(ids) == 0 {
		return nil
	}
	viewers, err := s.repository.VisibleViewers(ctx, postID, ids)
	if err != nil {
		slog.WarnContext(ctx, "load realtime post viewers", "post_id", postID, "error", err)
	}
	return viewers
}

func (s *Service) publishChange(ctx context.Context, postID, commentID int64, kind string) {
	s.publishTo(s.viewers(ctx, postID), Change{PostID: postID, CommentID: commentID}, kind)
}

func (s *Service) publishTo(viewers []int64, change Change, kind string) {
	if s.publisher == nil {
		return
	}
	if publisher, ok := s.publisher.(interface{ PublishMany([]int64, string, any) }); ok {
		publisher.PublishMany(viewers, kind, change)
		return
	}
	for _, id := range viewers {
		s.publisher.Publish(id, kind, change)
	}
}
