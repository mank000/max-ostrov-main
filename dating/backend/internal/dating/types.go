package dating

import "errors"

var (
	ErrNotFound      = errors.New("not found")
	ErrInvalid       = errors.New("invalid")
	ErrForbidden     = errors.New("forbidden")
	ErrConflict      = errors.New("conflict")
	ErrProfileNeeded = errors.New("profile needed")
)

type User struct {
	ID               int64  `json:"id"`
	SourceID         int64  `json:"source_id,omitempty"`
	Name             string `json:"name"`
	AdultConfirmedAt int64  `json:"adult_confirmed_at"`
	CreatedAt        int64  `json:"created_at"`
}

type Profile struct {
	Photos           []string `json:"photos,omitempty"`
	UserID           int64    `json:"user_id"`
	Name             string   `json:"name"`
	Age              int      `json:"age"`
	Gender           string   `json:"gender"`
	City             string   `json:"city"`
	Bio              string   `json:"bio"`
	Goal             string   `json:"goal"`
	Photo            string   `json:"photo"`
	Religion         string   `json:"religion,omitempty"`
	Smoking          string   `json:"smoking,omitempty"`
	Drinking         string   `json:"drinking,omitempty"`
	Worldview        string   `json:"worldview,omitempty"`
	Interests        []string `json:"interests,omitempty"`
	ShowGender       string   `json:"show_gender,omitempty"`
	MinAge           int      `json:"min_age,omitempty"`
	MaxAge           int      `json:"max_age,omitempty"`
	SameCityOnly     bool     `json:"same_city_only,omitempty"`
	VerifiedOnly     bool     `json:"verified_only,omitempty"`
	VerificationTier string   `json:"verification_tier,omitempty"`
	IsPaused         bool     `json:"is_paused,omitempty"`
	UpdatedAt        int64    `json:"-"`
}

type Settings struct {
	Goal           string   `json:"goal"`
	Religion       string   `json:"religion"`
	Smoking        string   `json:"smoking"`
	Drinking       string   `json:"drinking"`
	Worldview      string   `json:"worldview"`
	Interests      []string `json:"interests"`
	ShowGender     string   `json:"show_gender"`
	MinAge         int      `json:"min_age"`
	MaxAge         int      `json:"max_age"`
	SameCityOnly   bool     `json:"same_city_only"`
	VerifiedOnly   bool     `json:"verified_only"`
	IsPaused       bool     `json:"is_paused"`
	AdultConfirmed bool     `json:"adult_confirmed"`
}

type SwipeInput struct {
	UserID int64  `json:"user_id"`
	Kind   string `json:"kind"`
}

type ReportInput struct {
	UserID int64  `json:"user_id"`
	Reason string `json:"reason"`
}

type Match struct {
	Profile
	MatchID int64 `json:"match_id"`
}

type WeeklyStats struct {
	Matches   int `json:"matches"`
	LikedByMe int `json:"liked_by_me"`
	LikedMe   int `json:"liked_me"`
}

type Session struct {
	UserID  int64    `json:"user_id"`
	Name    string   `json:"name"`
	Source  *Profile `json:"source"`
	Profile *Profile `json:"profile"`
}

type SwipeResult struct {
	Match        bool  `json:"match"`
	MatchID      int64 `json:"match_id,omitempty"`
	FriendsReady bool  `json:"friends_ready"`
}

type ChatTarget struct {
	MaxChatID string `json:"max_chat_id"`
}

var InterestPool = []string{
	"Музыка", "Кино", "Сериалы", "Игры", "Книги", "Путешествия",
	"Спорт", "Зал", "Бег", "Плавание", "Велосипед", "Прогулки",
	"Кофе", "Готовка", "Рестораны", "Фотография", "Искусство", "Театр",
	"Концерты", "Технологии", "Психология", "Животные", "Мемы", "Настолки",
}
