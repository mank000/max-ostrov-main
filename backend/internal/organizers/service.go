package organizers

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"kutezh/backend/internal/contentpolicy"
	"kutezh/backend/internal/events"
)

var (
	ErrInvalidInput  = errors.New("invalid organizer input")
	ErrNotFound      = errors.New("organizer not found")
	ErrForbidden     = errors.New("organizer action forbidden")
	ErrNotVerified   = errors.New("organizer not verified")
	ErrAlreadyExists = errors.New("organizer already exists")
)

type Status string

const (
	StatusPending  Status = "pending"
	StatusVerified Status = "verified"
	StatusRejected Status = "rejected"
)

type Profile struct {
	ID               int64      `json:"id"`
	OwnerUserID      int64      `json:"owner_user_id"`
	Name             string     `json:"name"`
	Description      string     `json:"description"`
	Status           Status     `json:"status"`
	ReviewedByUserID *int64     `json:"reviewed_by_user_id,omitempty"`
	ReviewedAt       *time.Time `json:"reviewed_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type Input struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type Repository interface {
	Create(context.Context, int64, Input, time.Time) (Profile, error)
	ListOwned(context.Context, int64) ([]Profile, error)
	Get(context.Context, int64) (Profile, error)
	Update(context.Context, int64, int64, Input, time.Time) (Profile, error)
	Review(context.Context, int64, int64, Status, time.Time) (Profile, error)
	ListForReview(context.Context, int64, Status) ([]Profile, error)
	VerifiedOwned(context.Context, int64, int64) (Profile, error)
}

type EventCreator interface {
	CreateOfficial(context.Context, int64, int64, string, events.CreateInput) (events.Event, error)
}

type Publisher interface{ Publish(int64, string, any) }

type Service struct {
	repository Repository
	events     EventCreator
	publisher  Publisher
	now        func() time.Time
}

func NewService(repository Repository, eventCreator EventCreator, publisher Publisher) *Service {
	return &Service{repository: repository, events: eventCreator, publisher: publisher, now: time.Now}
}

func (s *Service) Create(ctx context.Context, userID int64, input Input) (Profile, error) {
	input = normalize(input)
	if !valid(input) {
		return Profile{}, ErrInvalidInput
	}
	if err := contentpolicy.CheckText(ctx, input.Name, input.Description); err != nil {
		return Profile{}, err
	}
	return s.repository.Create(ctx, userID, input, s.now())
}
func (s *Service) ListOwned(ctx context.Context, userID int64) ([]Profile, error) {
	return s.repository.ListOwned(ctx, userID)
}
func (s *Service) Get(ctx context.Context, id int64) (Profile, error) {
	if id <= 0 {
		return Profile{}, ErrNotFound
	}
	return s.repository.Get(ctx, id)
}
func (s *Service) Update(ctx context.Context, userID, id int64, input Input) (Profile, error) {
	input = normalize(input)
	if id <= 0 || !valid(input) {
		return Profile{}, ErrInvalidInput
	}
	if err := contentpolicy.CheckText(ctx, input.Name, input.Description); err != nil {
		return Profile{}, err
	}
	return s.repository.Update(ctx, userID, id, input, s.now())
}
func (s *Service) Review(ctx context.Context, reviewerID, id int64, status Status) (Profile, error) {
	if id <= 0 || (status != StatusVerified && status != StatusRejected) {
		return Profile{}, ErrInvalidInput
	}
	profile, err := s.repository.Review(ctx, reviewerID, id, status, s.now())
	if err == nil && s.publisher != nil {
		s.publisher.Publish(profile.OwnerUserID, "organizer.reviewed", map[string]any{"organizer_id": id, "status": status})
	}
	return profile, err
}
func (s *Service) ListForReview(ctx context.Context, reviewerID int64, status Status) ([]Profile, error) {
	if status != StatusPending && status != StatusVerified && status != StatusRejected {
		return nil, ErrInvalidInput
	}
	return s.repository.ListForReview(ctx, reviewerID, status)
}
func (s *Service) CreateEvent(ctx context.Context, userID, id int64, input events.CreateInput) (events.Event, error) {
	profile, err := s.repository.VerifiedOwned(ctx, userID, id)
	if err != nil {
		return events.Event{}, err
	}
	return s.events.CreateOfficial(ctx, userID, id, profile.Name, input)
}
func normalize(input Input) Input {
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	return input
}
func valid(input Input) bool {
	return runeLength(input.Name, 1, 120) && runeLength(input.Description, 0, 1000)
}
func runeLength(v string, min, max int) bool {
	n := utf8.RuneCountInString(v)
	return n >= min && n <= max
}
