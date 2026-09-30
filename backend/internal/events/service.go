package events

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"kutezh/backend/internal/contentpolicy"
	"kutezh/backend/internal/idempotency"
)

var (
	ErrNotFound              = errors.New("event not found")
	ErrInvalidEvent          = errors.New("invalid event")
	ErrUntrustedTicketURL     = errors.New("untrusted ticket url")
	ErrInvalidGeoQuery       = errors.New("invalid geographic query")
	ErrInvalidFilter         = errors.New("invalid event filter")
	ErrInvalidHistoryView    = errors.New("invalid event history view")
	ErrEventEnded            = errors.New("event has ended")
	ErrForbidden             = errors.New("event operation forbidden")
	ErrGroupMembership       = errors.New("user must leave event group first")
	ErrParticipationRequired = errors.New("event participation required")
	ErrIdempotencyConflict   = errors.New("idempotency key was used for another event")
)

var trustedTicketDomains = []string{
	"afisha.yandex.ru",
	"ticketland.ru",
	"kassir.ru",
	"redkassa.ru",
	"qtickets.ru",
	"qtickets.tours",
	"timepad.ru",
	"ticketscloud.com",
}

type Location struct {
	VenueName string   `json:"venue_name"`
	Address   string   `json:"address"`
	City      string   `json:"city"`
	Latitude  *float64 `json:"latitude,omitempty"`
	Longitude *float64 `json:"longitude,omitempty"`
}

type Source struct {
	Name      string    `json:"name"`
	URL       string    `json:"url,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Organizer struct {
	UserID    *int64 `json:"user_id,omitempty"`
	ProfileID *int64 `json:"profile_id,omitempty"`
	Name      string `json:"name"`
}

type Event struct {
	ID                  int64      `json:"id"`
	Title               string     `json:"title"`
	Description         string     `json:"description"`
	Category            string     `json:"category"`
	StartsAt            time.Time  `json:"starts_at"`
	EndsAt              *time.Time `json:"ends_at,omitempty"`
	Location            Location   `json:"location"`
	Organizer           Organizer  `json:"organizer"`
	Source              Source     `json:"source"`
	TicketURL           string     `json:"ticket_url,omitempty"`
	PriceMinRubles      *int64     `json:"price_min_rubles,omitempty"`
	HeaderSourceMediaID *int64     `json:"header_source_media_id,omitempty"`
	HeaderMediaID       *int64     `json:"header_media_id,omitempty"`
	IconSourceMediaID   *int64     `json:"icon_source_media_id,omitempty"`
	IconMediaID         *int64     `json:"icon_media_id,omitempty"`
	IsOfficial          bool       `json:"is_official"`
	IsPromoted          bool       `json:"is_promoted"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type CreateInput struct {
	Title               string     `json:"title"`
	Description         string     `json:"description"`
	Category            string     `json:"category"`
	StartsAt            time.Time  `json:"starts_at"`
	EndsAt              *time.Time `json:"ends_at"`
	Location            Location   `json:"location"`
	TicketURL           string     `json:"ticket_url"`
	PriceMinRubles      *int64     `json:"price_min_rubles"`
	HeaderSourceMediaID *int64     `json:"header_source_media_id"`
	HeaderMediaID       *int64     `json:"header_media_id"`
	IconSourceMediaID   *int64     `json:"icon_source_media_id"`
	IconMediaID         *int64     `json:"icon_media_id"`
}

type CreateRecord struct {
	CreateInput
	CreatorID          int64
	OrganizerName      string
	Source             Source
	OrganizerProfileID *int64
	IsOfficial         bool
	IdempotencyKey     string
	IdempotencyHash    []byte
}

type NearbyQuery struct {
	Latitude     float64
	Longitude    float64
	RadiusMeters int64
}

type NearbyEvent struct {
	Event          Event `json:"event"`
	DistanceMeters int64 `json:"distance_meters"`
}

type ViewportQuery struct {
	West    float64
	South   float64
	East    float64
	North   float64
	AfterID int64
}

type ViewportPage struct {
	Events     []Event `json:"events"`
	NextCursor *int64  `json:"next_cursor,omitempty"`
}

type Filter struct {
	Category       string
	City           string
	StartsFrom     *time.Time
	StartsTo       *time.Time
	PriceMaxRubles *int64
}

type Category struct {
	Name       string `json:"name"`
	EventCount int64  `json:"event_count"`
}

type Recommendation struct {
	Event            Event `json:"event"`
	Score            int64 `json:"score"`
	MatchesInterest  bool  `json:"matches_interest"`
	FriendsAttending int64 `json:"friends_attending"`
	ParticipantCount int64 `json:"participant_count"`
}

type Participant struct {
	ID                     int64    `json:"id"`
	Username               string   `json:"username,omitempty"`
	DisplayName            string   `json:"display_name"`
	Bio                    string   `json:"bio"`
	City                   string   `json:"city"`
	PhotoURL               string   `json:"photo_url,omitempty"`
	Interests              []string `json:"interests"`
	CommonInterests        []string `json:"common_interests"`
	IsFriend               bool     `json:"is_friend"`
	IsOrganizer            bool     `json:"is_organizer"`
	GroupID                *int64   `json:"group_id,omitempty"`
	EquippedDecorationCode string   `json:"equipped_decoration_code,omitempty"`
}

type HistoryView string

const (
	HistoryUpcoming HistoryView = "upcoming"
	HistoryPast     HistoryView = "past"
	HistorySaved    HistoryView = "saved"
	HistoryCreated  HistoryView = "created"
)

type Activity struct {
	ParticipatingEventIDs []int64 `json:"participating_event_ids"`
	SavedEventIDs         []int64 `json:"saved_event_ids"`
	GroupCount            int64   `json:"group_count"`
}

type HistoryItem struct {
	Event         Event `json:"event"`
	Participating bool  `json:"participating"`
	Saved         bool  `json:"saved"`
}

type Repository interface {
	Activity(context.Context, int64) (Activity, error)
	Create(context.Context, CreateRecord) (Event, error)
	Update(context.Context, int64, int64, CreateInput, time.Time) (Event, error)
	Delete(context.Context, int64, int64) error
	List(context.Context, time.Time, Filter, int) ([]Event, error)
	Get(context.Context, int64) (Event, error)
	Categories(context.Context, time.Time) ([]Category, error)
	Recommendations(context.Context, int64, time.Time, int) ([]Recommendation, error)
	Participants(context.Context, int64, int64, int) ([]Participant, error)
	Nearby(context.Context, NearbyQuery, time.Time, int) ([]NearbyEvent, error)
	Viewport(context.Context, ViewportQuery, time.Time, int) ([]Event, error)
	SetParticipation(context.Context, int64, int64, bool, time.Time) error
	SetSaved(context.Context, int64, int64, bool) error
	History(context.Context, int64, HistoryView, time.Time, int) ([]HistoryItem, error)
	ProfileEvents(context.Context, int64, int64, int64, time.Time, int) ([]HistoryItem, error)
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: time.Now}
}

func (s *Service) Create(ctx context.Context, creatorID int64, organizerName, idempotencyKey string, input CreateInput) (Event, error) {
	if !idempotency.ValidKey(idempotencyKey) {
		return Event{}, ErrInvalidEvent
	}
	return s.create(ctx, creatorID, organizerName, input, createOptions{
		sourceName:     "Пользовательское мероприятие",
		idempotencyKey: idempotencyKey,
	})
}

func (s *Service) CreateOfficial(ctx context.Context, creatorID, organizerProfileID int64, organizerName string, input CreateInput) (Event, error) {
	if organizerProfileID <= 0 {
		return Event{}, ErrInvalidEvent
	}
	return s.create(ctx, creatorID, organizerName, input, createOptions{
		organizerProfileID: &organizerProfileID,
		official:           true,
		sourceName:         "Официальный организатор",
	})
}

type createOptions struct {
	organizerProfileID *int64
	official           bool
	sourceName         string
	idempotencyKey     string
}

func (s *Service) create(ctx context.Context, creatorID int64, organizerName string, input CreateInput, opts createOptions) (Event, error) {
	now := s.now()
	organizerName = strings.TrimSpace(organizerName)

	if !prepareInput(&input) || !validNewEventStart(input.StartsAt, now) || !validLength(organizerName, 1, 120) {
		return Event{}, ErrInvalidEvent
	}
	if !validTicketDomain(input.TicketURL) {
		return Event{}, ErrUntrustedTicketURL
	}
	if err := contentpolicy.CheckText(ctx, input.Title, input.Description); err != nil {
		return Event{}, err
	}

	record := CreateRecord{
		CreateInput:   input,
		CreatorID:     creatorID,
		OrganizerName: organizerName,
		Source: Source{
			Name:      opts.sourceName,
			UpdatedAt: now,
		},
		OrganizerProfileID: opts.organizerProfileID,
		IsOfficial:         opts.official,
		IdempotencyKey:     opts.idempotencyKey,
		IdempotencyHash:    hashCreateInput(input),
	}
	return s.repository.Create(ctx, record)
}

func hashCreateInput(input CreateInput) []byte {
	payload, _ := json.Marshal(input)
	hash := sha256.Sum256(payload)
	return hash[:]
}

func (s *Service) List(ctx context.Context, filter Filter) ([]Event, error) {
	filter.Category = strings.TrimSpace(filter.Category)
	filter.City = strings.TrimSpace(filter.City)
	if !validLength(filter.Category, 0, 64) || !validLength(filter.City, 0, 80) {
		return nil, ErrInvalidFilter
	}
	if filter.StartsFrom != nil && filter.StartsTo != nil && filter.StartsTo.Before(*filter.StartsFrom) {
		return nil, ErrInvalidFilter
	}
	if filter.PriceMaxRubles != nil && *filter.PriceMaxRubles < 0 {
		return nil, ErrInvalidFilter
	}
	return s.repository.List(ctx, s.now(), filter, 100)
}

func (s *Service) Get(ctx context.Context, eventID int64) (Event, error) {
	return s.repository.Get(ctx, eventID)
}

func (s *Service) Update(ctx context.Context, userID, eventID int64, input CreateInput) (Event, error) {
	current, err := s.repository.Get(ctx, eventID)
	if err != nil {
		return Event{}, err
	}
	if current.Organizer.UserID == nil || *current.Organizer.UserID != userID {
		return Event{}, ErrForbidden
	}
	now := s.now()
	if !prepareInput(&input) {
		return Event{}, ErrInvalidEvent
	}
	if !validTicketDomain(input.TicketURL) {
		return Event{}, ErrUntrustedTicketURL
	}
	if err := contentpolicy.CheckText(ctx, input.Title, input.Description); err != nil {
		return Event{}, err
	}
	if current.StartsAt.After(now) {
		if !validNewEventStart(input.StartsAt, now) {
			return Event{}, ErrInvalidEvent
		}
	} else if !input.StartsAt.Equal(current.StartsAt) {
		return Event{}, ErrInvalidEvent
	}
	return s.repository.Update(ctx, userID, eventID, input, now)
}

func (s *Service) Delete(ctx context.Context, userID, eventID int64) error {
	current, err := s.repository.Get(ctx, eventID)
	if err != nil {
		return err
	}
	if current.Organizer.UserID == nil || *current.Organizer.UserID != userID {
		return ErrForbidden
	}
	return s.repository.Delete(ctx, userID, eventID)
}

func (s *Service) Categories(ctx context.Context) ([]Category, error) {
	categories, err := s.repository.Categories(ctx, s.now())
	if err != nil {
		return nil, err
	}
	// The picker must remain usable when there are no upcoming events.
	seen := make(map[string]bool, len(categories))
	for _, category := range categories {
		seen[strings.ToLower(strings.TrimSpace(category.Name))] = true
	}
	for _, name := range []string{
		"Встречи", "Музыка", "Кино", "Спорт", "Игры", "Творчество",
		"Еда", "Технологии", "Образование", "Прогулки", "Путешествия", "Вечеринки",
	} {
		if !seen[strings.ToLower(name)] {
			categories = append(categories, Category{Name: name})
		}
	}
	return categories, nil
}

func (s *Service) Recommendations(ctx context.Context, userID int64) ([]Recommendation, error) {
	return s.repository.Recommendations(ctx, userID, s.now(), 100)
}

func (s *Service) Participants(ctx context.Context, userID, eventID int64) ([]Participant, error) {
	return s.repository.Participants(ctx, userID, eventID, 100)
}

func (s *Service) Nearby(ctx context.Context, query NearbyQuery) ([]NearbyEvent, error) {
	if !validCoordinate(query.Latitude, 90) || !validCoordinate(query.Longitude, 180) {
		return nil, ErrInvalidGeoQuery
	}
	if query.RadiusMeters < 100 || query.RadiusMeters > 100_000 {
		return nil, ErrInvalidGeoQuery
	}
	return s.repository.Nearby(ctx, query, s.now(), 100)
}

func (s *Service) Viewport(ctx context.Context, query ViewportQuery) (ViewportPage, error) {
	if !validCoordinate(query.South, 90) || !validCoordinate(query.North, 90) ||
		!validCoordinate(query.West, 180) || !validCoordinate(query.East, 180) ||
		query.South >= query.North || query.West == query.East || query.AfterID < 0 {
		return ViewportPage{}, ErrInvalidGeoQuery
	}

	const pageSize = 250
	items, err := s.repository.Viewport(ctx, query, s.now(), pageSize+1)
	if err != nil {
		return ViewportPage{}, err
	}
	page := ViewportPage{Events: items}
	if len(items) > pageSize {
		page.Events = items[:pageSize]
		next := page.Events[len(page.Events)-1].ID
		page.NextCursor = &next
	}
	return page, nil
}

func validCoordinate(value, limit float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= -limit && value <= limit
}

func (s *Service) SetParticipation(ctx context.Context, userID, eventID int64, participating bool) error {
	event, err := s.repository.Get(ctx, eventID)
	if err != nil {
		return err
	}
	if event.Organizer.UserID != nil && *event.Organizer.UserID == userID {
		return ErrForbidden
	}
	return s.repository.SetParticipation(ctx, userID, eventID, participating, s.now())
}

func prepareInput(input *CreateInput) bool {
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.Category = strings.TrimSpace(input.Category)
	input.Location.VenueName = strings.TrimSpace(input.Location.VenueName)
	input.Location.Address = strings.TrimSpace(input.Location.Address)
	input.Location.City = strings.TrimSpace(input.Location.City)
	input.TicketURL = strings.TrimSpace(input.TicketURL)
	if input.Location.VenueName == "" {
		input.Location.VenueName = "Точка на карте"
	}
	if !validLength(input.Title, 1, 120) || !validLength(input.Description, 1, 4000) ||
		!validLength(input.Category, 1, 64) || !validLength(input.Location.VenueName, 1, 160) ||
		!validLength(input.Location.Address, 0, 240) || !validLength(input.Location.City, 0, 80) {
		return false
	}
	if input.StartsAt.IsZero() || (input.EndsAt != nil && !input.EndsAt.After(input.StartsAt)) {
		return false
	}
	if !validCoordinates(input.Location.Latitude, input.Location.Longitude) || !validOptionalURL(input.TicketURL) {
		return false
	}
	if input.PriceMinRubles != nil && *input.PriceMinRubles < 0 {
		return false
	}
	return validArtworkPair(input.HeaderSourceMediaID, input.HeaderMediaID) &&
		validArtworkPair(input.IconSourceMediaID, input.IconMediaID)
}

func validArtworkPair(sourceMediaID, cropMediaID *int64) bool {
	if sourceMediaID == nil && cropMediaID == nil {
		return true
	}
	return sourceMediaID != nil && cropMediaID != nil && *sourceMediaID > 0 && *cropMediaID > 0
}

func validNewEventStart(startsAt, now time.Time) bool {
	return startsAt.After(now)
}

func (s *Service) SetSaved(ctx context.Context, userID, eventID int64, saved bool) error {
	return s.repository.SetSaved(ctx, userID, eventID, saved)
}

func (s *Service) History(ctx context.Context, userID int64, view HistoryView) ([]HistoryItem, error) {
	if view != HistoryUpcoming && view != HistoryPast && view != HistorySaved && view != HistoryCreated {
		return nil, ErrInvalidHistoryView
	}
	return s.repository.History(ctx, userID, view, s.now(), 100)
}

func (s *Service) ProfileEvents(ctx context.Context, viewerID, targetID, beforeID int64) ([]HistoryItem, error) {
	if viewerID <= 0 || targetID <= 0 || beforeID < 0 {
		return nil, ErrInvalidFilter
	}
	return s.repository.ProfileEvents(ctx, viewerID, targetID, beforeID, s.now(), 50)
}

func validLength(value string, min, max int) bool {
	length := utf8.RuneCountInString(value)
	return length >= min && length <= max
}

func validCoordinates(latitude, longitude *float64) bool {
	if latitude == nil || longitude == nil {
		return false
	}
	return *latitude >= -90 && *latitude <= 90 && *longitude >= -180 && *longitude <= 180
}

func validOptionalURL(value string) bool {
	if value == "" {
		return true
	}
	if len(value) > 2048 {
		return false
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	if port := parsed.Port(); port != "" {
		if _, err := strconv.ParseUint(port, 10, 16); err != nil {
			return false
		}
	}
	return true
}

func validTicketDomain(value string) bool {
	if value == "" {
		return true
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	if port := parsed.Port(); port != "" && port != "443" {
		return false
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	for _, domain := range trustedTicketDomains {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

func (s *Service) Activity(ctx context.Context, userID int64) (Activity, error) {
	return s.repository.Activity(ctx, userID)
}
