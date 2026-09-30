package users

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"kutezh/backend/internal/contentpolicy"
	"kutezh/backend/internal/maxauth"
)

var (
	ErrNotFound       = errors.New("user not found")
	ErrInvalidProfile = errors.New("invalid profile")
	ErrUsernameTaken  = errors.New("username is already taken")
	ErrInvalidSearch  = errors.New("invalid user search")
	ErrInvalidAvatar  = errors.New("invalid profile avatar")
)

type InvalidProfileFieldError struct {
	Message string
}

func (e *InvalidProfileFieldError) Error() string { return e.Message }
func (e *InvalidProfileFieldError) Unwrap() error { return ErrInvalidProfile }

func invalidProfileField(message string) error {
	return &InvalidProfileFieldError{Message: message}
}

var usernamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{2,31}$`)
var providerUsernamePattern = regexp.MustCompile(`^[a-z0-9_]{3,64}$`)

type AuthProvider string

const (
	ProviderMAX AuthProvider = "max"
)

type ParticipantVisibility string

const (
	VisibilityParticipants ParticipantVisibility = "participants"
	VisibilityHidden       ParticipantVisibility = "hidden"
)

type ProfileAvatar struct {
	MediaID     int64  `json:"media_id"`
	URL         string `json:"url"`
	CropMediaID *int64 `json:"crop_media_id,omitempty"`
	CropURL     string `json:"crop_url,omitempty"`
	Position    int    `json:"position"`
	IsPrimary   bool   `json:"is_primary"`
}

type Profile struct {
	HideSensitiveLanguage     bool                  `json:"hide_sensitive_language"`
	ShowOnline                bool                  `json:"show_online"`
	PrivateProfile            bool                  `json:"private_profile"`
	ShowBirthDate             bool                  `json:"show_birth_date"`
	ModerationRole            string                `json:"moderation_role,omitempty"`
	ID                        int64                 `json:"id"`
	Username                  string                `json:"username,omitempty"`
	FirstName                 string                `json:"first_name"`
	LastName                  string                `json:"last_name,omitempty"`
	DisplayName               string                `json:"display_name"`
	Bio                       string                `json:"bio"`
	City                      string                `json:"city"`
	Gender                    string                `json:"gender,omitempty"`
	BirthDate                 string                `json:"birth_date,omitempty"`
	Age                       *int                  `json:"age,omitempty"`
	FaceVerified              bool                  `json:"face_verified"`
	VerificationTier          string                `json:"verification_tier"`
	FaceVerificationAvailable bool                  `json:"face_verification_available,omitempty"`
	LanguageCode              string                `json:"language_code,omitempty"`
	PhotoURL                  string                `json:"photo_url,omitempty"`
	AvatarMediaID             *int64                `json:"avatar_media_id,omitempty"`
	Avatars                   []ProfileAvatar       `json:"avatars,omitempty"`
	Interests                 []string              `json:"interests"`
	ParticipantVisibility     ParticipantVisibility `json:"participant_visibility"`
	EquippedDecorationCode    string                `json:"equipped_decoration_code,omitempty"`
	OnboardingVersion         int                   `json:"onboarding_version"`
	CreatedAt                 time.Time             `json:"created_at"`
	UpdatedAt                 time.Time             `json:"updated_at"`
}

type Update struct {
	HideSensitiveLanguage *bool                  `json:"hide_sensitive_language"`
	ShowOnline            *bool                  `json:"show_online"`
	PrivateProfile        *bool                  `json:"private_profile"`
	ShowBirthDate         *bool                  `json:"show_birth_date"`
	Username              *string                `json:"username"`
	DisplayName           *string                `json:"display_name"`
	Bio                   *string                `json:"bio"`
	City                  *string                `json:"city"`
	Gender                *string                `json:"gender"`
	BirthDate             *string                `json:"birth_date"`
	Interests             *[]string              `json:"interests"`
	ParticipantVisibility *ParticipantVisibility `json:"participant_visibility"`
	OnboardingComplete    *bool                  `json:"onboarding_complete"`
}

type PublicProfile struct {
	ID                     int64           `json:"id"`
	Username               string          `json:"username,omitempty"`
	DisplayName            string          `json:"display_name"`
	Bio                    string          `json:"bio"`
	City                   string          `json:"city"`
	BirthDate              string          `json:"birth_date,omitempty"`
	Age                    *int            `json:"age,omitempty"`
	FaceVerified           bool            `json:"face_verified"`
	VerificationTier       string          `json:"verification_tier"`
	PhotoURL               string          `json:"photo_url,omitempty"`
	Avatars                []ProfileAvatar `json:"avatars,omitempty"`
	Interests              []string        `json:"interests"`
	EquippedDecorationCode string          `json:"equipped_decoration_code,omitempty"`
	FriendRequestStatus    string          `json:"friend_request_status,omitempty"`
}

type Suggestion struct {
	PublicProfile
	ReasonCode string `json:"reason_code"`
	Reason     string `json:"reason"`
}

type RelationshipState string

const (
	RelationshipSelf     RelationshipState = "self"
	RelationshipStranger RelationshipState = "stranger"
	RelationshipOutgoing RelationshipState = "outgoing"
	RelationshipIncoming RelationshipState = "incoming"
	RelationshipFriend   RelationshipState = "friend"
	RelationshipBlocked  RelationshipState = "blocked"
)

type PublicProfileDetails struct {
	PublicProfile
	PrivateProfile    bool              `json:"private_profile"`
	Restricted        bool              `json:"restricted"`
	RelationshipState RelationshipState `json:"relationship_state"`
	MutualInterests   []string          `json:"mutual_interests"`
	CommonEventCount  int64             `json:"common_event_count"`
	FriendCount       int64             `json:"friend_count"`
	PostCount         int64             `json:"post_count"`
	EventCount        int64             `json:"event_count"`
	LastSeenAt        *time.Time        `json:"last_seen_at,omitempty"`
	IsOnline          bool              `json:"is_online"`
}

type Repository interface {
	UpsertProviderUser(context.Context, AuthProvider, maxauth.User, string) (Profile, error)
	Get(context.Context, int64) (Profile, error)
	GetPublic(context.Context, int64, int64) (PublicProfileDetails, error)
	TouchPresence(context.Context, int64) error
	SetAvatar(context.Context, int64, *int64) (Profile, error)
	AddAvatar(context.Context, int64, int64) (Profile, error)
	SetAvatarCrop(context.Context, int64, int64, int64) (Profile, error)
	RemoveAvatar(context.Context, int64, int64) (Profile, error)
	ReorderAvatars(context.Context, int64, []int64) (Profile, error)
	Update(context.Context, int64, Update) (Profile, error)
	Search(context.Context, int64, string, int) ([]PublicProfile, error)
	Suggestions(context.Context, int64, int) ([]Suggestion, error)
}

type Service struct {
	repository Repository
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository}
}

func (s *Service) UpsertFromProvider(ctx context.Context, provider AuthProvider, user maxauth.User) (Profile, error) {
	if provider != ProviderMAX {
		return Profile{}, ErrInvalidProfile
	}
	user.FirstName = strings.TrimSpace(user.FirstName)
	user.LastName = strings.TrimSpace(user.LastName)
	user.Username = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(user.Username)), "@")
	if !validLength(user.FirstName, 1, 80) || !validLength(user.LastName, 0, 80) ||
		!validLength(user.LanguageCode, 0, 16) || len(user.PhotoURL) > 2048 ||
		(user.Username != "" && !providerUsernamePattern.MatchString(user.Username)) {
		return Profile{}, ErrInvalidProfile
	}
	displayName := strings.TrimSpace(user.FirstName + " " + user.LastName)
	if runeLength(displayName) > 80 {
		displayName = user.FirstName
	}
	// Authentication uses the provider ID. Unsafe public metadata must not lock
	// the owner out of their account; they can choose a moderated profile name.
	if err := contentpolicy.CheckText(ctx, displayName); err != nil {
		user.FirstName, user.LastName, displayName = "Пользователь", "", "Пользователь"
	}
	if err := contentpolicy.CheckText(ctx, strings.ReplaceAll(user.Username, "_", " ")); err != nil {
		user.Username = ""
	}
	return s.repository.UpsertProviderUser(ctx, provider, user, displayName)
}

func (s *Service) Get(ctx context.Context, userID int64) (Profile, error) {
	return s.repository.Get(ctx, userID)
}

func (s *Service) GetPublic(ctx context.Context, viewerID, targetID int64) (PublicProfileDetails, error) {
	if viewerID <= 0 || targetID <= 0 {
		return PublicProfileDetails{}, ErrNotFound
	}
	return s.repository.GetPublic(ctx, viewerID, targetID)
}

func (s *Service) TouchPresence(ctx context.Context, userID int64) error {
	if userID <= 0 {
		return ErrNotFound
	}
	return s.repository.TouchPresence(ctx, userID)
}

func (s *Service) SetAvatar(ctx context.Context, userID int64, mediaID *int64) (Profile, error) {
	if userID <= 0 || (mediaID != nil && *mediaID <= 0) {
		return Profile{}, ErrInvalidAvatar
	}
	return s.repository.SetAvatar(ctx, userID, mediaID)
}

func (s *Service) AddAvatar(ctx context.Context, userID, mediaID int64) (Profile, error) {
	if userID <= 0 || mediaID <= 0 {
		return Profile{}, ErrInvalidAvatar
	}
	return s.repository.AddAvatar(ctx, userID, mediaID)
}

func (s *Service) SetAvatarCrop(ctx context.Context, userID, sourceMediaID, cropMediaID int64) (Profile, error) {
	if userID <= 0 || sourceMediaID <= 0 || cropMediaID <= 0 {
		return Profile{}, ErrInvalidAvatar
	}
	return s.repository.SetAvatarCrop(ctx, userID, sourceMediaID, cropMediaID)
}

func (s *Service) RemoveAvatar(ctx context.Context, userID, mediaID int64) (Profile, error) {
	if userID <= 0 || mediaID <= 0 {
		return Profile{}, ErrInvalidAvatar
	}
	return s.repository.RemoveAvatar(ctx, userID, mediaID)
}

func (s *Service) ReorderAvatars(ctx context.Context, userID int64, mediaIDs []int64) (Profile, error) {
	if userID <= 0 || len(mediaIDs) == 0 {
		return Profile{}, ErrInvalidAvatar
	}
	seen := make(map[int64]struct{}, len(mediaIDs))
	for _, mediaID := range mediaIDs {
		if mediaID <= 0 {
			return Profile{}, ErrInvalidAvatar
		}
		if _, exists := seen[mediaID]; exists {
			return Profile{}, ErrInvalidAvatar
		}
		seen[mediaID] = struct{}{}
	}
	return s.repository.ReorderAvatars(ctx, userID, mediaIDs)
}

func (s *Service) Update(ctx context.Context, userID int64, update Update) (Profile, error) {
	if update.Username != nil {
		value := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(*update.Username)), "@")
		if !usernamePattern.MatchString(value) {
			return Profile{}, invalidProfileField("Имя пользователя: 3–32 символа, первая — латинская буква, далее буквы, цифры или _")
		}
		update.Username = &value
	}
	if update.DisplayName != nil {
		value := strings.TrimSpace(*update.DisplayName)
		if runeLength(value) < 1 || runeLength(value) > 80 {
			return Profile{}, invalidProfileField("Укажите имя длиной до 80 символов")
		}
		update.DisplayName = &value
	}
	if update.Bio != nil {
		value := strings.TrimSpace(*update.Bio)
		if runeLength(value) > 500 {
			return Profile{}, invalidProfileField("Текст «О себе» не должен превышать 500 символов")
		}
		update.Bio = &value
	}
	if update.City != nil {
		value := strings.TrimSpace(*update.City)
		if runeLength(value) > 80 {
			return Profile{}, invalidProfileField("Название города не должно превышать 80 символов")
		}
		update.City = &value
	}
	if update.Gender != nil {
		value := strings.ToLower(strings.TrimSpace(*update.Gender))
		if value != "man" && value != "woman" {
			return Profile{}, invalidProfileField("Выберите пол в профиле")
		}
		update.Gender = &value
	}
	if update.BirthDate != nil {
		value := strings.TrimSpace(*update.BirthDate)
		birthDate, err := time.Parse("2006-01-02", value)
		if err != nil {
			return Profile{}, invalidProfileField("Укажите корректную дату рождения")
		}
		now := time.Now().UTC()
		age := now.Year() - birthDate.Year()
		if now.Month() < birthDate.Month() || (now.Month() == birthDate.Month() && now.Day() < birthDate.Day()) {
			age--
		}
		if age < 13 || age > 100 {
			return Profile{}, invalidProfileField("Возраст должен быть от 13 до 100 лет")
		}
		normalized := birthDate.Format("2006-01-02")
		update.BirthDate = &normalized
	}
	if update.OnboardingComplete != nil {
		if !*update.OnboardingComplete || update.Username == nil || update.DisplayName == nil || update.City == nil || update.BirthDate == nil ||
			*update.Username == "" || *update.City == "" || *update.BirthDate == "" {
			return Profile{}, invalidProfileField("Заполните имя, имя пользователя, город и дату рождения")
		}
	}
	if update.Interests != nil {
		interests, ok := normalizeInterests(*update.Interests)
		if !ok {
			return Profile{}, invalidProfileField("Проверьте данные профиля")
		}
		update.Interests = &interests
	}
	if update.ParticipantVisibility != nil &&
		*update.ParticipantVisibility != VisibilityParticipants &&
		*update.ParticipantVisibility != VisibilityHidden {
		return Profile{}, invalidProfileField("Выберите, кто видит вас среди участников")
	}
	var profileText []string
	if update.Username != nil {
		profileText = append(profileText, strings.ReplaceAll(*update.Username, "_", " "))
	}
	if update.DisplayName != nil {
		profileText = append(profileText, *update.DisplayName)
	}
	if update.Bio != nil {
		profileText = append(profileText, *update.Bio)
	}
	if update.Interests != nil {
		profileText = append(profileText, *update.Interests...)
	}
	if err := contentpolicy.CheckText(ctx, profileText...); err != nil {
		return Profile{}, err
	}

	return s.repository.Update(ctx, userID, update)
}

func (s *Service) Search(ctx context.Context, userID int64, query string) ([]PublicProfile, error) {
	query = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(query)), "@")
	if runeLength(query) < 2 || runeLength(query) > 80 {
		return nil, ErrInvalidSearch
	}
	return s.repository.Search(ctx, userID, query, 20)
}

func (s *Service) Suggestions(ctx context.Context, userID int64) ([]Suggestion, error) {
	return s.repository.Suggestions(ctx, userID, 20)
}

func normalizeInterests(values []string) ([]string, bool) {
	if len(values) > 10 {
		return nil, false
	}

	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if runeLength(value) < 1 || runeLength(value) > 40 {
			return nil, false
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result, true
}

func runeLength(value string) int {
	return utf8.RuneCountInString(value)
}

func validLength(value string, min, max int) bool {
	length := runeLength(value)
	return length >= min && length <= max
}
