package notifications

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("notification not found")

type Notification struct {
	ID               int64      `json:"id"`
	Kind             string     `json:"kind"`
	Title            string     `json:"title"`
	Body             string     `json:"body"`
	EventID          *int64     `json:"event_id,omitempty"`
	PostID           *int64     `json:"post_id,omitempty"`
	IsClip           bool       `json:"is_clip,omitempty"`
	GiftID           *int64     `json:"gift_id,omitempty"`
	GroupID          *int64     `json:"group_id,omitempty"`
	ActorUserID      *int64     `json:"actor_user_id,omitempty"`
	ActorDisplayName string     `json:"actor_display_name,omitempty"`
	ActorUsername    string     `json:"actor_username,omitempty"`
	ActorPhotoURL    string     `json:"actor_photo_url,omitempty"`
	ReadAt           *time.Time `json:"read_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

type Counts struct {
	Unread   int64 `json:"unread"`
	Gifts    int64 `json:"gifts"`
	Clips    int64 `json:"clips"`
	Messages int64 `json:"messages"`
	Matches  int64 `json:"matches"`
}

type Page struct {
	Notifications []Notification `json:"notifications"`
	NextCursor    *int64         `json:"next_cursor,omitempty"`
}

type Repository interface {
	Counts(context.Context, int64) (Counts, error)
	List(context.Context, int64, bool, int64, int) ([]Notification, error)
	MarkRead(context.Context, int64, int64, time.Time) error
	MarkAllRead(context.Context, int64, time.Time) error
	MarkMatchesRead(context.Context, int64, time.Time) error
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: time.Now}
}

func (s *Service) List(ctx context.Context, userID int64, unreadOnly bool, beforeID int64) (Page, error) {
	items, err := s.repository.List(ctx, userID, unreadOnly, beforeID, 101)
	if err != nil {
		return Page{}, err
	}
	page := Page{Notifications: items}
	if len(items) > 100 {
		page.Notifications = items[:100]
		cursor := items[99].ID
		page.NextCursor = &cursor
	}
	return page, nil
}

func (s *Service) MarkRead(ctx context.Context, userID, notificationID int64) error {
	if notificationID <= 0 {
		return ErrNotFound
	}
	return s.repository.MarkRead(ctx, userID, notificationID, s.now())
}

func (s *Service) MarkAllRead(ctx context.Context, userID int64) error {
	return s.repository.MarkAllRead(ctx, userID, s.now())
}

func (s *Service) MarkMatchesRead(ctx context.Context, userID int64) error {
	return s.repository.MarkMatchesRead(ctx, userID, s.now())
}

func (s *Service) Counts(ctx context.Context, userID int64) (Counts, error) {
	return s.repository.Counts(ctx, userID)
}
