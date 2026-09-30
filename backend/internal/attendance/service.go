package attendance

import (
	"context"
	"errors"
	"math"
	"time"
)

var (
	ErrInvalidEvidence       = errors.New("invalid attendance evidence")
	ErrNotFound              = errors.New("attendance or event not found")
	ErrParticipationRequired = errors.New("event participation required")
	ErrOutsideWindow         = errors.New("attendance window is closed")
	ErrInvalidMedia          = errors.New("invalid attendance media")
	ErrOrganizerRequired     = errors.New("event organizer required")
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusConfirmed Status = "confirmed"
	StatusRejected  Status = "rejected"
)

type EvidenceInput struct {
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	MediaIDs  []int64  `json:"media_ids"`
}

type ReviewInput struct {
	Status Status `json:"status"`
}

type Confirmation struct {
	EventID             int64      `json:"event_id"`
	UserID              int64      `json:"user_id"`
	Status              Status     `json:"status"`
	LocationMatched     bool       `json:"location_matched"`
	EvidenceSubmittedAt time.Time  `json:"evidence_submitted_at"`
	ReviewedByUserID    *int64     `json:"reviewed_by_user_id,omitempty"`
	ReviewedAt          *time.Time `json:"reviewed_at,omitempty"`
	MediaIDs            []int64    `json:"media_ids"`
}

type EventContext struct {
	Title       string
	StartsAt    time.Time
	EndsAt      *time.Time
	Latitude    *float64
	Longitude   *float64
	OrganizerID *int64
}

type Repository interface {
	EventContext(context.Context, int64, int64) (EventContext, error)
	Submit(context.Context, int64, int64, EvidenceInput, Status, bool, time.Time) (Confirmation, error)
	Get(context.Context, int64, int64) (Confirmation, error)
	ListForOrganizer(context.Context, int64, int64) ([]Confirmation, error)
	Review(context.Context, int64, int64, int64, Status, time.Time) (Confirmation, error)
}

type Publisher interface {
	Publish(int64, string, any)
}

type Service struct {
	repository Repository
	publisher  Publisher
	now        func() time.Time
}

func NewService(repository Repository, publisher Publisher) *Service {
	return &Service{repository: repository, publisher: publisher, now: time.Now}
}

func (s *Service) Submit(ctx context.Context, userID, eventID int64, input EvidenceInput) (Confirmation, error) {
	if userID <= 0 || eventID <= 0 || !validEvidence(input) {
		return Confirmation{}, ErrInvalidEvidence
	}
	event, err := s.repository.EventContext(ctx, userID, eventID)
	if err != nil {
		return Confirmation{}, err
	}
	now := s.now()
	endsAt := event.StartsAt.Add(4 * time.Hour)
	if event.EndsAt != nil {
		endsAt = *event.EndsAt
	}
	if now.Before(event.StartsAt.Add(-2*time.Hour)) || now.After(endsAt.Add(12*time.Hour)) {
		return Confirmation{}, ErrOutsideWindow
	}

	locationMatched := false
	if input.Latitude != nil && event.Latitude != nil && event.Longitude != nil {
		locationMatched = distanceMeters(*input.Latitude, *input.Longitude, *event.Latitude, *event.Longitude) <= 500
	}

	confirmation, err := s.repository.Submit(ctx, userID, eventID, input, StatusPending, locationMatched, now)
	if err != nil {
		return Confirmation{}, err
	}
	if s.publisher != nil {
		s.publisher.Publish(userID, "attendance.updated", map[string]any{
			"event_id": eventID, "status": confirmation.Status,
		})
	}
	return confirmation, nil
}

func (s *Service) Get(ctx context.Context, userID, eventID int64) (Confirmation, error) {
	return s.repository.Get(ctx, userID, eventID)
}

func (s *Service) ListForOrganizer(ctx context.Context, organizerID, eventID int64) ([]Confirmation, error) {
	if organizerID <= 0 || eventID <= 0 {
		return nil, ErrNotFound
	}
	return s.repository.ListForOrganizer(ctx, organizerID, eventID)
}

func (s *Service) Review(ctx context.Context, reviewerID, eventID, userID int64, input ReviewInput) (Confirmation, error) {
	if reviewerID <= 0 || eventID <= 0 || userID <= 0 || reviewerID == userID ||
		(input.Status != StatusConfirmed && input.Status != StatusRejected) {
		return Confirmation{}, ErrInvalidEvidence
	}
	confirmation, err := s.repository.Review(ctx, reviewerID, eventID, userID, input.Status, s.now())
	if err != nil {
		return Confirmation{}, err
	}
	if s.publisher != nil {
		s.publisher.Publish(userID, "attendance.updated", map[string]any{
			"event_id": eventID, "status": confirmation.Status,
		})
	}
	return confirmation, nil
}

func validEvidence(input EvidenceInput) bool {
	if (input.Latitude == nil) != (input.Longitude == nil) || len(input.MediaIDs) > 5 {
		return false
	}
	if input.Latitude == nil && len(input.MediaIDs) == 0 {
		return false
	}
	if input.Latitude != nil && (math.IsNaN(*input.Latitude) || math.IsInf(*input.Latitude, 0) ||
		math.IsNaN(*input.Longitude) || math.IsInf(*input.Longitude, 0) ||
		*input.Latitude < -90 || *input.Latitude > 90 || *input.Longitude < -180 || *input.Longitude > 180) {
		return false
	}
	seen := make(map[int64]struct{}, len(input.MediaIDs))
	for _, mediaID := range input.MediaIDs {
		if mediaID <= 0 {
			return false
		}
		if _, exists := seen[mediaID]; exists {
			return false
		}
		seen[mediaID] = struct{}{}
	}
	return true
}

func distanceMeters(firstLat, firstLon, secondLat, secondLon float64) float64 {
	const earthRadius = 6_371_000
	toRadians := func(value float64) float64 { return value * math.Pi / 180 }
	lat1, lat2 := toRadians(firstLat), toRadians(secondLat)
	dLat := toRadians(secondLat - firstLat)
	dLon := toRadians(secondLon - firstLon)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
	a = math.Max(0, math.Min(1, a))
	return earthRadius * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
