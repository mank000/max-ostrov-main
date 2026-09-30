package posts

import "context"

func (s *Service) RankedFeed(ctx context.Context, userID int64, cursor string) ([]Post, *string, error) {
	if userID <= 0 {
		return nil, nil, ErrInvalidPost
	}
	return s.repository.RankedFeed(ctx, userID, cursor, 50)
}

func (s *Service) HideFromFeed(ctx context.Context, userID, postID int64) error {
	if userID <= 0 || postID <= 0 {
		return ErrInvalidPost
	}
	return s.repository.HideFromFeed(ctx, userID, postID)
}

func (s *Service) RankedComments(ctx context.Context, userID, postID int64, cursor string) ([]Comment, *string, error) {
	if userID <= 0 || postID <= 0 {
		return nil, nil, ErrInvalidComment
	}
	return s.repository.RankedComments(ctx, userID, postID, cursor, 50)
}
