package social

import (
	"context"
	"errors"
	"time"
)

var (
	ErrInvalidUser           = errors.New("invalid user")
	ErrNotFound              = errors.New("social relation not found")
	ErrBlocked               = errors.New("users are blocked")
	ErrAlreadyFriends        = errors.New("users are already friends")
	ErrRequestExists         = errors.New("friend request already exists")
	ErrFriendshipRequired    = errors.New("friendship required")
	ErrParticipationRequired = errors.New("event participation required")
	ErrAlreadyParticipating  = errors.New("user already participates in event")
	ErrEventEnded            = errors.New("event has ended")
)

type User struct {
	MAXChatID   string     `json:"max_chat_id,omitempty"`
	ID          int64      `json:"id"`
	Username    string     `json:"username,omitempty"`
	DisplayName string     `json:"display_name"`
	City        string     `json:"city"`
	BirthDate   string     `json:"birth_date,omitempty"`
	PhotoURL    string     `json:"photo_url,omitempty"`
	LastSeenAt  *time.Time `json:"last_seen_at,omitempty"`
	IsOnline    bool       `json:"is_online,omitempty"`
	MAXUserID   int64      `json:"max_user_id,omitempty"`
}

type FriendRequest struct {
	User      User      `json:"user"`
	CreatedAt time.Time `json:"created_at"`
}

type Friend struct {
	User      User      `json:"user"`
	CreatedAt time.Time `json:"created_at"`
}

type FriendCursor struct {
	CreatedAt time.Time
	UserID    int64
}

type FriendPage struct {
	Friends    []Friend
	NextCursor *FriendCursor
	TotalCount int64
}

type DirectMessageTarget struct {
	MAXChatID string `json:"max_chat_id,omitempty"`
	MAXUserID int64  `json:"max_user_id,omitempty"`
}

type BlockedUser struct {
	User      User      `json:"user"`
	CreatedAt time.Time `json:"created_at"`
}

type EventInvitation struct {
	EventID    int64     `json:"event_id"`
	EventTitle string    `json:"event_title"`
	StartsAt   time.Time `json:"starts_at"`
	Sender     User      `json:"sender"`
	CreatedAt  time.Time `json:"created_at"`
}

type Repository interface {
	FollowState(context.Context, int64, int64) (FollowState, error)
	SetFollowing(context.Context, int64, int64, bool) error
	SendFriendRequest(context.Context, int64, int64) error
	ListFriendRequests(context.Context, int64, int) ([]FriendRequest, error)
	ListOutgoingFriendRequests(context.Context, int64, int) ([]FriendRequest, error)
	ResolveFriendRequest(context.Context, int64, int64, bool) error
	ListFriends(context.Context, int64, int, *FriendCursor) ([]Friend, error)
	CountFriends(context.Context, int64) (int64, error)
	ListPublicFriends(context.Context, int64, int64, int, *FriendCursor) ([]Friend, error)
	DirectMessageTarget(context.Context, int64, int64) (DirectMessageTarget, error)
	RemoveFriend(context.Context, int64, int64) error
	Block(context.Context, int64, int64) error
	Unblock(context.Context, int64, int64) error
	ListBlocked(context.Context, int64, int) ([]BlockedUser, error)
	InviteToEvent(context.Context, int64, int64, int64, time.Time) error
	ListEventInvitations(context.Context, int64, time.Time, int) ([]EventInvitation, error)
	ResolveEventInvitation(context.Context, int64, int64, int64, bool, time.Time) error
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: time.Now}
}

func (s *Service) CreateFriendship(ctx context.Context, userID, targetID int64) error {
	if !validPair(userID, targetID) {
		return ErrInvalidUser
	}
	creator, ok := s.repository.(interface {
		CreateFriendship(context.Context, int64, int64) error
	})
	if !ok {
		return ErrNotFound
	}
	return creator.CreateFriendship(ctx, userID, targetID)
}

func (s *Service) SendFriendRequest(ctx context.Context, userID, targetID int64) error {
	if !validPair(userID, targetID) {
		return ErrInvalidUser
	}
	return s.repository.SendFriendRequest(ctx, userID, targetID)
}

func (s *Service) ListFriendRequests(ctx context.Context, userID int64) ([]FriendRequest, error) {
	return s.repository.ListFriendRequests(ctx, userID, 100)
}

func (s *Service) ListOutgoingFriendRequests(ctx context.Context, userID int64) ([]FriendRequest, error) {
	return s.repository.ListOutgoingFriendRequests(ctx, userID, 100)
}

func (s *Service) ResolveFriendRequest(ctx context.Context, userID, requesterID int64, accept bool) error {
	if !validPair(userID, requesterID) {
		return ErrInvalidUser
	}
	return s.repository.ResolveFriendRequest(ctx, userID, requesterID, accept)
}

func (s *Service) ListFriends(ctx context.Context, userID int64, before *FriendCursor) (FriendPage, error) {
	if userID <= 0 {
		return FriendPage{}, ErrInvalidUser
	}
	const pageSize = 100
	items, err := s.repository.ListFriends(ctx, userID, pageSize+1, before)
	if err != nil {
		return FriendPage{}, err
	}
	count, err := s.repository.CountFriends(ctx, userID)
	if err != nil {
		return FriendPage{}, err
	}
	page := FriendPage{Friends: items, TotalCount: count}
	if len(items) > pageSize {
		page.Friends = items[:pageSize]
		last := page.Friends[len(page.Friends)-1]
		page.NextCursor = &FriendCursor{CreatedAt: last.CreatedAt, UserID: last.User.ID}
	}
	return page, nil
}

func (s *Service) BirthdaysToday(ctx context.Context, userID int64) ([]Friend, error) {
	if userID <= 0 {
		return nil, ErrInvalidUser
	}
	repository, ok := s.repository.(interface {
		ListBirthdayFriends(context.Context, int64, int) ([]Friend, error)
	})
	if !ok {
		return []Friend{}, nil
	}
	return repository.ListBirthdayFriends(ctx, userID, 100)
}

func (s *Service) ListPublicFriends(ctx context.Context, viewerID, targetID int64, before *FriendCursor) (FriendPage, error) {
	if viewerID <= 0 || targetID <= 0 {
		return FriendPage{}, ErrInvalidUser
	}
	const pageSize = 100
	items, err := s.repository.ListPublicFriends(ctx, viewerID, targetID, pageSize+1, before)
	if err != nil {
		return FriendPage{}, err
	}
	page := FriendPage{Friends: items}
	if len(items) > pageSize {
		page.Friends = items[:pageSize]
		last := page.Friends[len(page.Friends)-1]
		page.NextCursor = &FriendCursor{CreatedAt: last.CreatedAt, UserID: last.User.ID}
	}
	return page, nil
}

func (s *Service) DirectMessageTarget(ctx context.Context, userID, friendID int64) (DirectMessageTarget, error) {
	if !validPair(userID, friendID) {
		return DirectMessageTarget{}, ErrInvalidUser
	}
	return s.repository.DirectMessageTarget(ctx, userID, friendID)
}

func (s *Service) RemoveFriend(ctx context.Context, userID, friendID int64) error {
	if !validPair(userID, friendID) {
		return ErrInvalidUser
	}
	return s.repository.RemoveFriend(ctx, userID, friendID)
}

func (s *Service) Block(ctx context.Context, userID, blockedID int64) error {
	if !validPair(userID, blockedID) {
		return ErrInvalidUser
	}
	return s.repository.Block(ctx, userID, blockedID)
}

func (s *Service) Unblock(ctx context.Context, userID, blockedID int64) error {
	if !validPair(userID, blockedID) {
		return ErrInvalidUser
	}
	return s.repository.Unblock(ctx, userID, blockedID)
}

func (s *Service) ListBlocked(ctx context.Context, userID int64) ([]BlockedUser, error) {
	return s.repository.ListBlocked(ctx, userID, 100)
}

func (s *Service) InviteToEvent(ctx context.Context, userID, eventID, friendID int64) error {
	if eventID <= 0 || !validPair(userID, friendID) {
		return ErrInvalidUser
	}
	return s.repository.InviteToEvent(ctx, userID, eventID, friendID, s.now())
}

func (s *Service) ListEventInvitations(ctx context.Context, userID int64) ([]EventInvitation, error) {
	return s.repository.ListEventInvitations(ctx, userID, s.now(), 100)
}

func (s *Service) ResolveEventInvitation(
	ctx context.Context,
	userID, eventID, senderID int64,
	accept bool,
) error {
	if eventID <= 0 || !validPair(userID, senderID) {
		return ErrInvalidUser
	}
	return s.repository.ResolveEventInvitation(ctx, userID, eventID, senderID, accept, s.now())
}

func validPair(first, second int64) bool {
	return first > 0 && second > 0 && first != second
}

func (s *Service) SetFollowing(ctx context.Context, viewer, target int64, following bool) error {
	if viewer <= 0 || target <= 0 || viewer == target {
		return ErrInvalidUser
	}
	return s.repository.SetFollowing(ctx, viewer, target, following)
}
