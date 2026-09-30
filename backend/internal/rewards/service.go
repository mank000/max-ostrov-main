package rewards

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalidInput        = errors.New("invalid rewards input")
	ErrNotFound            = errors.New("rewards resource not found")
	ErrAlreadyOwned        = errors.New("profile decoration already owned")
	ErrInsufficientBalance = errors.New("insufficient coin balance")
	ErrForbidden           = errors.New("rewards action forbidden")
	ErrNotFriends          = errors.New("friendship required")
	ErrIdempotencyConflict = errors.New("idempotency key conflict")
)

type Wallet struct {
	Unlimited bool      `json:"unlimited"`
	Balance   int64     `json:"balance"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Transaction struct {
	Complimentary bool      `json:"complimentary"`
	ID            int64     `json:"id"`
	Amount        int64     `json:"amount"`
	Kind          string    `json:"kind"`
	Description   string    `json:"description"`
	ReferenceType string    `json:"reference_type,omitempty"`
	ReferenceID   string    `json:"reference_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type Achievement struct {
	Code        string     `json:"code"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Progress    int        `json:"progress"`
	Target      int        `json:"target"`
	RewardCoins int64      `json:"reward_coins"`
	UnlockedAt  *time.Time `json:"unlocked_at,omitempty"`
}

type Item struct {
	Code          string `json:"code"`
	Kind          string `json:"kind"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	CoinPrice     int64  `json:"coin_price"`
	DurationHours *int   `json:"duration_hours,omitempty"`
}

type PurchaseInput struct {
	ItemCode       string `json:"item_code"`
	TargetEventID  *int64 `json:"target_event_id,omitempty"`
	IdempotencyKey string `json:"idempotency_key"`
}

type Purchase struct {
	ID            int64      `json:"id"`
	ItemCode      string     `json:"item_code"`
	TargetEventID *int64     `json:"target_event_id,omitempty"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type GiftInput struct {
	ItemCode       string `json:"item_code"`
	Message        string `json:"message"`
	IdempotencyKey string `json:"idempotency_key"`
}

type GiftSender struct {
	ID          int64  `json:"id"`
	Username    string `json:"username,omitempty"`
	DisplayName string `json:"display_name"`
	PhotoURL    string `json:"photo_url,omitempty"`
}

type Gift struct {
	ID          int64       `json:"id"`
	SenderID    int64       `json:"sender_user_id"`
	RecipientID int64       `json:"recipient_user_id"`
	ItemCode    string      `json:"item_code"`
	Title       string      `json:"title"`
	Message     string      `json:"message"`
	CreatedAt   time.Time   `json:"created_at"`
	Sender      *GiftSender `json:"sender,omitempty"`
}

type Repository interface {
	Wallet(context.Context, int64) (Wallet, error)
	Transactions(context.Context, int64, int64, int) ([]Transaction, error)
	Achievements(context.Context, int64, time.Time) ([]Achievement, []string, error)
	Items(context.Context) ([]Item, error)
	Purchase(context.Context, int64, PurchaseInput, time.Time) (Purchase, error)
	SetDecoration(context.Context, int64, string) error
	SendGift(context.Context, int64, int64, GiftInput, time.Time) (Gift, error)
	Gifts(context.Context, int64, int64, int) ([]Gift, error)
}

type Publisher interface{ Publish(int64, string, any) }

type Service struct {
	repository Repository
	publisher  Publisher
	now        func() time.Time
}

func NewService(repository Repository, publisher Publisher) *Service {
	return &Service{repository: repository, publisher: publisher, now: time.Now}
}

func (s *Service) Wallet(ctx context.Context, userID int64) (Wallet, error) {
	return s.repository.Wallet(ctx, userID)
}

func (s *Service) Transactions(ctx context.Context, userID, beforeID int64) ([]Transaction, error) {
	if beforeID < 0 {
		return nil, ErrInvalidInput
	}
	return s.repository.Transactions(ctx, userID, beforeID, 50)
}

func (s *Service) Achievements(ctx context.Context, userID int64) ([]Achievement, error) {
	items, unlocked, err := s.repository.Achievements(ctx, userID, s.now())
	if err == nil && s.publisher != nil {
		for _, code := range unlocked {
			s.publisher.Publish(userID, "achievement.unlocked", map[string]string{"code": code})
		}
	}
	return items, err
}

func (s *Service) Items(ctx context.Context) ([]Item, error) { return s.repository.Items(ctx) }

func (s *Service) Purchase(ctx context.Context, userID int64, input PurchaseInput) (Purchase, error) {
	input.ItemCode = strings.TrimSpace(input.ItemCode)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.ItemCode == "" || !fitsLength(input.IdempotencyKey, 8, 120) ||
		(input.TargetEventID != nil && *input.TargetEventID <= 0) {
		return Purchase{}, ErrInvalidInput
	}
	return s.repository.Purchase(ctx, userID, input, s.now())
}

func (s *Service) SetDecoration(ctx context.Context, userID int64, code string) error {
	code = strings.TrimSpace(code)
	if len(code) > 40 {
		return ErrInvalidInput
	}
	return s.repository.SetDecoration(ctx, userID, code)
}

func (s *Service) SendGift(ctx context.Context, senderID, recipientID int64, input GiftInput) (Gift, error) {
	input.ItemCode = strings.TrimSpace(input.ItemCode)
	input.Message = strings.TrimSpace(input.Message)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if senderID <= 0 || recipientID <= 0 || senderID == recipientID || input.ItemCode == "" ||
		!fitsLength(input.Message, 0, 240) || !fitsLength(input.IdempotencyKey, 8, 120) {
		return Gift{}, ErrInvalidInput
	}
	gift, err := s.repository.SendGift(ctx, senderID, recipientID, input, s.now())
	if err == nil && s.publisher != nil {
		s.publisher.Publish(recipientID, "gift.received", map[string]int64{"gift_id": gift.ID, "sender_user_id": senderID})
	}
	return gift, err
}

func (s *Service) Gifts(ctx context.Context, userID, beforeID int64) ([]Gift, error) {
	if beforeID < 0 {
		return nil, ErrInvalidInput
	}
	return s.repository.Gifts(ctx, userID, beforeID, 50)
}

func fitsLength(value string, min, max int) bool {
	n := utf8.RuneCountInString(value)
	return n >= min && n <= max
}
