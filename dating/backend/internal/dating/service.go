package dating

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type Config struct {
	LinkFriends func(context.Context, int64, int64) error
	OpenChat    func(context.Context, int64, int64) (ChatTarget, error)
}

type Service struct {
	repository Repository
	config     Config
}

type ServiceError struct {
	Status int
	Detail string
}

func (e *ServiceError) Error() string {
	return e.Detail
}

func NewService(repository Repository, config Config) *Service {
	return &Service{
		repository: repository,
		config:     config,
	}
}

func (s *Service) Auth(ctx context.Context, userID int64) (Session, error) {
	user, source, profile, err := s.repository.Session(ctx, userID)
	if err != nil {
		return Session{}, err
	}
	return Session{
		UserID:  userID,
		Name:    user.Name,
		Source:  source,
		Profile: profile,
	}, nil
}

func (s *Service) Profile(ctx context.Context, userID int64) (*Profile, error) {
	return s.repository.GetProfile(ctx, userID)
}

func (s *Service) SaveProfile(ctx context.Context, userID int64, settings Settings) (Profile, error) {
	if !validGoal(settings.Goal) || !validShowGender(settings.ShowGender) ||
		!validReligion(settings.Religion) || !validHabit(settings.Smoking) ||
		!validHabit(settings.Drinking) || !validWorldview(settings.Worldview) ||
		settings.MinAge < 16 || settings.MinAge > 100 ||
		settings.MaxAge < 16 || settings.MaxAge > 100 ||
		settings.MinAge > settings.MaxAge {
		return Profile{}, status(http.StatusBadRequest, "Некорректные настройки знакомств")
	}
	interests, ok := normalizeInterests(settings.Interests)
	if !ok {
		return Profile{}, status(http.StatusBadRequest, "Выбери не больше 8 интересов из списка")
	}
	settings.Interests = interests
	profile, err := s.repository.SaveSettings(ctx, userID, settings)
	if errors.Is(err, ErrInvalid) {
		return Profile{}, status(http.StatusBadRequest, "Возраст поиска должен оставаться внутри твоего раздела: 16–17 или 18+")
	}
	if errors.Is(err, ErrForbidden) {
		return Profile{}, status(http.StatusForbidden, "Знакомства доступны с 16 лет. Для 18+ нужно подтвердить совершеннолетие, а пол берётся из основного профиля.")
	}
	return profile, err
}

func (s *Service) Discover(ctx context.Context, userID int64) ([]Profile, error) {
	return s.repository.Discover(ctx, userID)
}

func (s *Service) Swipe(ctx context.Context, userID int64, input SwipeInput) (SwipeResult, error) {
	if input.UserID <= 0 || (input.Kind != "like" && input.Kind != "pass") {
		return SwipeResult{}, status(http.StatusBadRequest, "Некорректный свайп")
	}
	created, matchID, err := s.repository.Swipe(ctx, userID, input)
	if err != nil {
		return SwipeResult{}, err
	}
	ready := false
	if matchID > 0 && (created || s.config.LinkFriends == nil) {
		ready = s.syncFriendship(ctx, matchID)
	}
	return SwipeResult{
		Match:        created,
		MatchID:      matchID,
		FriendsReady: ready,
	}, nil
}

func (s *Service) Matches(ctx context.Context, userID int64) ([]Match, error) {
	return s.repository.Matches(ctx, userID)
}

func (s *Service) WeeklyStats(ctx context.Context, userID int64) (WeeklyStats, error) {
	if repository, ok := s.repository.(interface {
		WeeklyStats(context.Context, int64) (WeeklyStats, error)
	}); ok {
		return repository.WeeklyStats(ctx, userID)
	}
	return WeeklyStats{}, nil
}

func (s *Service) Unmatch(ctx context.Context, userID, matchID int64) error {
	if matchID <= 0 {
		return ErrInvalid
	}
	if repository, ok := s.repository.(interface {
		Unmatch(context.Context, int64, int64) error
	}); ok {
		return repository.Unmatch(ctx, userID, matchID)
	}
	return ErrForbidden
}

func (s *Service) Chat(ctx context.Context, userID, matchID int64) (ChatTarget, error) {
	if s.config.OpenChat == nil {
		return ChatTarget{}, status(http.StatusServiceUnavailable, "MAX чат недоступен")
	}
	other, err := s.repository.MatchOther(ctx, matchID, userID)
	if err != nil {
		return ChatTarget{}, err
	}
	return s.config.OpenChat(ctx, userID, other)
}
func (s *Service) Block(ctx context.Context, userID, otherID int64) error {
	if otherID <= 0 || otherID == userID {
		return status(http.StatusBadRequest, "Нельзя скрыть эту анкету")
	}
	return s.repository.Block(ctx, userID, otherID)
}

func (s *Service) Report(ctx context.Context, userID int64, input ReportInput) error {
	input.Reason = strings.TrimSpace(input.Reason)
	if input.UserID <= 0 || input.UserID == userID || len([]rune(input.Reason)) < 2 || len([]rune(input.Reason)) > 300 {
		return status(http.StatusBadRequest, "Некорректная жалоба")
	}
	return s.repository.Report(ctx, userID, input)
}

func (s *Service) Delete(ctx context.Context, userID int64) error {
	return s.repository.DeleteUser(ctx, userID)
}

func (s *Service) syncFriendship(ctx context.Context, matchID int64) bool {
	if s.config.LinkFriends == nil {
		return false
	}
	a, b, err := s.repository.MatchSourceIDs(ctx, matchID)
	return err == nil && s.config.LinkFriends(ctx, a, b) == nil
}

func validGoal(value string) bool {
	return value == "chat" || value == "date" || value == "relationship"
}

func validShowGender(value string) bool {
	return value == "all" || value == "man" || value == "woman"
}

func validReligion(value string) bool {
	switch value {
	case "", "orthodox", "catholic", "islam", "buddhism", "judaism", "atheism", "agnostic", "other":
		return true
	default:
		return false
	}
}

func validHabit(value string) bool {
	return value == "" || value == "no" || value == "sometimes" || value == "yes"
}

func validWorldview(value string) bool {
	switch value {
	case "", "traditional", "modern", "balanced", "spiritual", "rational", "no_label":
		return true
	default:
		return false
	}
}

func normalizeInterests(values []string) ([]string, bool) {
	if len(values) > 8 {
		return nil, false
	}
	allowed := make(map[string]struct{}, len(InterestPool))
	for _, value := range InterestPool {
		allowed[value] = struct{}{}
	}
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if _, ok := allowed[value]; !ok {
			return nil, false
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out, true
}

func normalizeAPIURL(value string) string {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	return strings.TrimSuffix(value, "/api/v1")
}

func copyHeaders(target, source http.Header) {
	for key, values := range source {
		for _, value := range values {
			target.Add(key, value)
		}
	}
}

func rawID(value json.RawMessage) string {
	if len(value) == 0 {
		return ""
	}
	var text string
	if json.Unmarshal(value, &text) == nil {
		return text
	}
	var number json.Number
	if json.Unmarshal(value, &number) == nil {
		return number.String()
	}
	return ""
}

func status(code int, detail string) error {
	return &ServiceError{
		Status: code,
		Detail: detail,
	}
}

func StatusError(err error) (int, string) {
	var serviceError *ServiceError
	if errors.As(err, &serviceError) {
		return serviceError.Status, serviceError.Detail
	}
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound, "Не найдено"
	case errors.Is(err, ErrInvalid):
		return http.StatusBadRequest, "Некорректный запрос"
	case errors.Is(err, ErrForbidden):
		return http.StatusForbidden, "Действие недоступно"
	case errors.Is(err, ErrConflict):
		return http.StatusConflict, "Действие конфликтует с текущим состоянием"
	case errors.Is(err, ErrProfileNeeded):
		return http.StatusConflict, "Сначала создай анкету знакомств"
	default:
		return http.StatusInternalServerError, "Внутренняя ошибка"
	}
}

func (s *Service) Undo(ctx context.Context, userID, targetID int64) (Profile, error) {
	if targetID <= 0 || targetID == userID {
		return Profile{}, status(http.StatusBadRequest, "Некорректная анкета")
	}
	repository, ok := s.repository.(interface {
		Undo(context.Context, int64, int64) (Profile, error)
	})
	if !ok {
		return Profile{}, status(http.StatusConflict, "Возврат недоступен в автономном режиме")
	}
	profile, err := repository.Undo(ctx, userID, targetID)
	if errors.Is(err, ErrConflict) {
		return Profile{}, status(http.StatusConflict, "Можно вернуть только последнюю анкету без взаимной симпатии")
	}
	return profile, err
}
