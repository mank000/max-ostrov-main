package moderation

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"time"
)

var (
	ErrInvalid     = errors.New("invalid moderation request")
	ErrNotFound    = errors.New("moderation item not found")
	ErrForbidden   = errors.New("moderator role required")
	ErrConflict    = errors.New("moderation item changed")
	ErrAuth        = errors.New("invalid moderation credentials")
	ErrUnavailable = errors.New("moderation login unavailable")
	ErrRateLimited = errors.New("moderation request rate limited")
)

type TargetType string

const (
	TargetUser    TargetType = "user"
	TargetPost    TargetType = "post"
	TargetEvent   TargetType = "event"
	TargetComment TargetType = "comment"
)

func (t TargetType) Valid() bool {
	return t == TargetUser || t == TargetPost || t == TargetEvent || t == TargetComment
}

type ReportInput struct {
	TargetType TargetType `json:"target_type"`
	TargetID   int64      `json:"target_id"`
	Reason     string     `json:"reason"`
}

type ReportMedia struct {
	ID       int64  `json:"id"`
	MIMEType string `json:"mime_type"`
}

type Report struct {
	Media            []ReportMedia   `json:"media,omitempty"`
	ID               int64           `json:"id"`
	ReporterUserID   *int64          `json:"reporter_user_id"`
	TargetType       TargetType      `json:"target_type"`
	TargetID         int64           `json:"target_id"`
	Reason           string          `json:"reason"`
	TargetSnapshot   json.RawMessage `json:"target_snapshot"`
	Status           string          `json:"status"`
	Version          int             `json:"version"`
	ReviewedByUserID *int64          `json:"reviewed_by_user_id"`
	ReviewedAt       *time.Time      `json:"reviewed_at"`
	CreatedAt        time.Time       `json:"created_at"`
}

type DecisionInput struct {
	Action  string `json:"action"`
	Reason  string `json:"reason"`
	Version int    `json:"version"`
}

type Action struct {
	ID            int64      `json:"id"`
	ReportID      *int64     `json:"report_id"`
	ActorUserID   int64      `json:"actor_user_id"`
	TargetType    TargetType `json:"target_type"`
	TargetID      int64      `json:"target_id"`
	Action        string     `json:"action"`
	Reason        string     `json:"reason"`
	PreviousState string     `json:"previous_state"`
	NextState     string     `json:"next_state"`
	CreatedAt     time.Time  `json:"created_at"`
}

type Principal struct {
	UserID       int64  `json:"user_id"`
	Role         string `json:"role"`
	SupportOwner bool   `json:"-"`
}

type CodeSender interface {
	SendCode(context.Context, int64, string) error
}

type Service struct {
	db        *sql.DB
	publisher interface{ Publish(int64, string, any) }
	sender    CodeSender
	secret    []byte
	mediaDir  string
	now       func() time.Time
	random    io.Reader
}

func (s *Service) WithRealtime(publisher interface{ Publish(int64, string, any) }) *Service {
	s.publisher = publisher
	return s
}

func NewService(db *sql.DB, sender CodeSender, secret []byte, mediaDir string) *Service {
	return &Service{db: db, sender: sender, secret: secret, mediaDir: mediaDir, now: time.Now, random: rand.Reader}
}

func (s *Service) LoginReady() bool {
	return s != nil && s.sender != nil && len(s.secret) >= 32
}
