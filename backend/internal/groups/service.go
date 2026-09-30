package groups

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"kutezh/backend/internal/contentpolicy"
	"kutezh/backend/internal/idempotency"
)

const (
	MinCapacity                 = 2
	MaxCapacity                 = 12
	PolicyOpen       JoinPolicy = "open"
	PolicyRequest    JoinPolicy = "request"
	PolicyInviteOnly JoinPolicy = "invite_only"
)

var (
	ErrNotFound            = errors.New("group or event not found")
	ErrInvalidGroup        = errors.New("invalid group")
	ErrInvalidChatLink     = errors.New("invalid group chat link")
	ErrEventEnded          = errors.New("event has ended")
	ErrNotParticipant      = errors.New("user is not an event participant")
	ErrAlreadyInGroup      = errors.New("user already belongs to a group for this event")
	ErrGroupFull           = errors.New("group is full")
	ErrCapacityTooSmall    = errors.New("group capacity is below current member count")
	ErrCannotRemoveLeader  = errors.New("group leader cannot be removed")
	ErrForbidden           = errors.New("group action is forbidden")
	ErrRequestRequired     = errors.New("join request is required")
	ErrInvitationNeeded    = errors.New("group invitation is required")
	ErrInvalidMerge        = errors.New("groups cannot be merged")
	ErrBlocked             = errors.New("users are blocked")
	ErrIdempotencyConflict = errors.New("idempotency key was used for another group")
)

type JoinPolicy string

type Group struct {
	ID               int64      `json:"id"`
	EventID          int64      `json:"event_id"`
	LeaderUserID     int64      `json:"leader_user_id"`
	Title            string     `json:"title"`
	JoinPolicy       JoinPolicy `json:"join_policy"`
	Capacity         int        `json:"capacity"`
	MemberCount      int        `json:"member_count"`
	AvailablePlaces  int        `json:"available_places"`
	Joined           bool       `json:"joined"`
	IsLeader         bool       `json:"is_leader"`
	JoinRequested    bool       `json:"join_requested"`
	Invited          bool       `json:"invited"`
	ReinviteRequired bool       `json:"reinvite_required"`
	ChatProvider     string     `json:"chat_provider,omitempty"`
	ChatURL          string     `json:"chat_url,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type CreateInput struct {
	Title           string     `json:"title"`
	Capacity        int        `json:"capacity"`
	JoinPolicy      JoinPolicy `json:"join_policy"`
	ChatProvider    string     `json:"chat_provider"`
	ChatURL         string     `json:"chat_url"`
	IdempotencyKey  string     `json:"-"`
	IdempotencyHash []byte     `json:"-"`
}

type UpdateInput struct {
	Title        string     `json:"title"`
	Capacity     int        `json:"capacity"`
	JoinPolicy   JoinPolicy `json:"join_policy"`
	ChatProvider string     `json:"chat_provider"`
	ChatURL      string     `json:"chat_url"`
}

type Candidate struct {
	GroupID     int64     `json:"group_id"`
	UserID      int64     `json:"user_id"`
	DisplayName string    `json:"display_name"`
	PhotoURL    string    `json:"photo_url,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type Member struct {
	ID          int64     `json:"id"`
	Username    string    `json:"username,omitempty"`
	DisplayName string    `json:"display_name"`
	PhotoURL    string    `json:"photo_url,omitempty"`
	IsLeader    bool      `json:"is_leader"`
	JoinedAt    time.Time `json:"joined_at"`
}

type Invitation struct {
	Group     Group     `json:"group"`
	CreatedAt time.Time `json:"created_at"`
}

type MergeRequest struct {
	SourceGroup Group     `json:"source_group"`
	CreatedAt   time.Time `json:"created_at"`
}

type Repository interface {
	Create(context.Context, int64, int64, CreateInput, time.Time) (Group, error)
	List(context.Context, int64, int64, time.Time) ([]Group, error)
	ListMembers(context.Context, int64, int64) ([]Member, error)
	Update(context.Context, int64, int64, UpdateInput, time.Time) error
	RemoveMember(context.Context, int64, int64, int64, time.Time) error
	TransferLeadership(context.Context, int64, int64, int64, time.Time) error
	Join(context.Context, int64, int64, time.Time) error
	Leave(context.Context, int64, int64) error
	RequestJoin(context.Context, int64, int64, time.Time) error
	ListRequests(context.Context, int64, int64) ([]Candidate, error)
	ResolveRequest(context.Context, int64, int64, int64, bool, time.Time) error
	Invite(context.Context, int64, int64, int64, time.Time) error
	ListInvitations(context.Context, int64, time.Time) ([]Invitation, error)
	ResolveInvitation(context.Context, int64, int64, bool, time.Time) error
	RequestMerge(context.Context, int64, int64, int64, time.Time) error
	ListMergeRequests(context.Context, int64, int64, time.Time) ([]MergeRequest, error)
	ResolveMerge(context.Context, int64, int64, int64, bool, time.Time) error
}

type Service struct {
	repository Repository
	now        func() time.Time
}

func NewService(repository Repository) *Service {
	return &Service{repository: repository, now: time.Now}
}

func (s *Service) Create(ctx context.Context, userID, eventID int64, idempotencyKey string, input CreateInput) (Group, error) {
	input.Title = strings.TrimSpace(input.Title)
	chatProvider, chatURL, err := normalizeGroupChat(input.ChatProvider, input.ChatURL)
	if err != nil {
		return Group{}, err
	}
	input.ChatProvider, input.ChatURL = chatProvider, chatURL
	if input.JoinPolicy == "" {
		input.JoinPolicy = PolicyOpen
	}
	if length := utf8.RuneCountInString(input.Title); length < 1 || length > 80 ||
		input.Capacity < MinCapacity || input.Capacity > MaxCapacity || !validPolicy(input.JoinPolicy) ||
		!idempotency.ValidKey(idempotencyKey) {
		return Group{}, ErrInvalidGroup
	}
	if err := contentpolicy.CheckText(ctx, input.Title); err != nil {
		return Group{}, err
	}
	input.IdempotencyKey = idempotencyKey
	input.IdempotencyHash = hashCreateInput(input)
	return s.repository.Create(ctx, userID, eventID, input, s.now())
}

func normalizeGroupChat(provider, rawURL string) (string, string, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	rawURL = strings.TrimSpace(rawURL)
	if provider == "" && rawURL == "" {
		return "", "", nil
	}
	if provider != "max" || rawURL == "" || len(rawURL) > 500 {
		return "", "", ErrInvalidChatLink
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), "max.ru") ||
		parsed.Port() != "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" ||
		!strings.HasPrefix(parsed.Path, "/join/") || len(parsed.Path) <= len("/join/") || strings.Contains(parsed.Path[len("/join/"):], "/") {
		return "", "", ErrInvalidChatLink
	}
	return "max", parsed.String(), nil
}

func hashCreateInput(input CreateInput) []byte {
	input.IdempotencyKey = ""
	input.IdempotencyHash = nil
	payload, _ := json.Marshal(input)
	hash := sha256.Sum256(payload)
	return hash[:]
}

func validPolicy(policy JoinPolicy) bool {
	return policy == PolicyOpen || policy == PolicyRequest || policy == PolicyInviteOnly
}

func (s *Service) List(ctx context.Context, userID, eventID int64) ([]Group, error) {
	return s.repository.List(ctx, userID, eventID, s.now())
}

func (s *Service) ListMembers(ctx context.Context, userID, groupID int64) ([]Member, error) {
	return s.repository.ListMembers(ctx, userID, groupID)
}

func (s *Service) Update(ctx context.Context, leaderID, groupID int64, input UpdateInput) error {
	input.Title = strings.TrimSpace(input.Title)
	chatProvider, chatURL, err := normalizeGroupChat(input.ChatProvider, input.ChatURL)
	if err != nil {
		return err
	}
	input.ChatProvider, input.ChatURL = chatProvider, chatURL
	if length := utf8.RuneCountInString(input.Title); length < 1 || length > 80 ||
		input.Capacity < MinCapacity || input.Capacity > MaxCapacity || !validPolicy(input.JoinPolicy) {
		return ErrInvalidGroup
	}
	if err := contentpolicy.CheckText(ctx, input.Title); err != nil {
		return err
	}
	return s.repository.Update(ctx, leaderID, groupID, input, s.now())
}

func (s *Service) RemoveMember(ctx context.Context, leaderID, groupID, userID int64) error {
	return s.repository.RemoveMember(ctx, leaderID, groupID, userID, s.now())
}

func (s *Service) TransferLeadership(ctx context.Context, leaderID, groupID, userID int64) error {
	return s.repository.TransferLeadership(ctx, leaderID, groupID, userID, s.now())
}

func (s *Service) Join(ctx context.Context, userID, groupID int64) error {
	return s.repository.Join(ctx, userID, groupID, s.now())
}

func (s *Service) Leave(ctx context.Context, userID, groupID int64) error {
	return s.repository.Leave(ctx, userID, groupID)
}

func (s *Service) RequestJoin(ctx context.Context, userID, groupID int64) error {
	return s.repository.RequestJoin(ctx, userID, groupID, s.now())
}

func (s *Service) ListRequests(ctx context.Context, leaderID, groupID int64) ([]Candidate, error) {
	return s.repository.ListRequests(ctx, leaderID, groupID)
}

func (s *Service) ResolveRequest(ctx context.Context, leaderID, groupID, userID int64, accept bool) error {
	return s.repository.ResolveRequest(ctx, leaderID, groupID, userID, accept, s.now())
}

func (s *Service) Invite(ctx context.Context, leaderID, groupID, userID int64) error {
	return s.repository.Invite(ctx, leaderID, groupID, userID, s.now())
}

func (s *Service) ListInvitations(ctx context.Context, userID int64) ([]Invitation, error) {
	return s.repository.ListInvitations(ctx, userID, s.now())
}

func (s *Service) ResolveInvitation(ctx context.Context, userID, groupID int64, accept bool) error {
	return s.repository.ResolveInvitation(ctx, userID, groupID, accept, s.now())
}

func (s *Service) RequestMerge(ctx context.Context, leaderID, sourceGroupID, targetGroupID int64) error {
	if sourceGroupID == targetGroupID {
		return ErrInvalidMerge
	}
	return s.repository.RequestMerge(ctx, leaderID, sourceGroupID, targetGroupID, s.now())
}

func (s *Service) ListMergeRequests(ctx context.Context, leaderID, targetGroupID int64) ([]MergeRequest, error) {
	return s.repository.ListMergeRequests(ctx, leaderID, targetGroupID, s.now())
}

func (s *Service) ResolveMerge(ctx context.Context, leaderID, targetGroupID, sourceGroupID int64, accept bool) error {
	if sourceGroupID == targetGroupID {
		return ErrInvalidMerge
	}
	return s.repository.ResolveMerge(ctx, leaderID, targetGroupID, sourceGroupID, accept, s.now())
}
