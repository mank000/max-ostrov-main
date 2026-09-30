package posts

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"kutezh/backend/internal/contentpolicy"
	"kutezh/backend/internal/idempotency"
)

var (
	ErrInvalidPost           = errors.New("invalid post")
	ErrCityRequired          = errors.New("post city required")
	ErrNotFound              = errors.New("post not found")
	ErrParticipationRequired = errors.New("event participation required")
	ErrInvalidMedia          = errors.New("invalid post media")
	ErrInvalidTag            = errors.New("invalid participant tag")
	ErrInvalidComment        = errors.New("invalid comment")
	ErrIdempotencyConflict   = errors.New("idempotency key was used for another post")
)

type User struct {
	ID                     int64  `json:"id"`
	Username               string `json:"username,omitempty"`
	DisplayName            string `json:"display_name"`
	PhotoURL               string `json:"photo_url,omitempty"`
	EquippedDecorationCode string `json:"equipped_decoration_code,omitempty"`
	RelationshipState      string `json:"relationship_state,omitempty"`
}

type Media struct {
	ID         int64  `json:"id"`
	MIMEType   string `json:"mime_type"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMS int    `json:"duration_ms"`
	URL        string `json:"url"`
}

type Repost struct {
	Unavailable bool       `json:"unavailable"`
	ID          int64      `json:"id,omitempty"`
	EventID     *int64     `json:"event_id,omitempty"`
	Visibility  string     `json:"visibility,omitempty"`
	City        string     `json:"city,omitempty"`
	Author      *User      `json:"author,omitempty"`
	Caption     string     `json:"caption,omitempty"`
	Media       []Media    `json:"media,omitempty"`
	CreatedAt   *time.Time `json:"created_at,omitempty"`
}

type Post struct {
	ID             int64     `json:"id"`
	EventID        *int64    `json:"event_id,omitempty"`
	Visibility     string    `json:"visibility"`
	City           string    `json:"city"`
	Author         User      `json:"author"`
	Caption        string    `json:"caption"`
	Media          []Media   `json:"media"`
	Tagged         []User    `json:"tagged_participants"`
	RepostOfPostID *int64    `json:"repost_of_post_id,omitempty"`
	Repost         *Repost   `json:"repost,omitempty"`
	RepostCount    int64     `json:"repost_count"`
	RepostedByMe   bool      `json:"reposted_by_me"`
	LikeCount      int64     `json:"like_count"`
	CommentCount   int64     `json:"comment_count"`
	LikedByMe      bool      `json:"liked_by_me"`
	CreatedAt      time.Time `json:"created_at"`
}

type Comment struct {
	ID              int64     `json:"id"`
	RankPosition    *int      `json:"rank_position,omitempty"`
	PostID          int64     `json:"post_id"`
	ParentCommentID *int64    `json:"parent_comment_id,omitempty"`
	Author          User      `json:"author"`
	ReplyTo         *User     `json:"reply_to,omitempty"`
	Body            string    `json:"body"`
	Media           []Media   `json:"media"`
	LikeCount       int64     `json:"like_count"`
	LikedByMe       bool      `json:"liked_by_me"`
	CreatedAt       time.Time `json:"created_at"`
}

type CreateInput struct {
	CoverMS        int     `json:"cover_ms,omitempty"`
	IsClip         bool    `json:"is_clip,omitempty"`
	EventID        *int64  `json:"event_id"`
	Visibility     string  `json:"visibility"`
	City           string  `json:"city"`
	Caption        string  `json:"caption"`
	MediaIDs       []int64 `json:"media_ids"`
	TaggedUserIDs  []int64 `json:"tagged_user_ids"`
	RepostOfPostID *int64  `json:"repost_of_post_id,omitempty"`
}

type FeedScope string

const (
	FeedScopeAll     FeedScope = "all"
	FeedScopeCity    FeedScope = "city"
	FeedScopeFriends FeedScope = "friends"
)

func (scope FeedScope) Valid() bool {
	return scope == FeedScopeAll || scope == FeedScopeCity || scope == FeedScopeFriends
}

type Repository interface {
	ListByIDs(context.Context, int64, []int64) ([]Post, error)
	VisibleViewers(context.Context, int64, []int64) ([]int64, error)
	CommentPost(context.Context, int64, int64) (int64, error)
	CommentsByIDs(context.Context, int64, int64, []int64) ([]Comment, error)
	UpdatePost(context.Context, int64, int64, UpdateInput, time.Time) (Post, error)
	ListTagged(context.Context, int64, int64, int64, int) ([]Post, error)
	RankedFeed(context.Context, int64, string, int) ([]Post, *string, error)
	RankedComments(context.Context, int64, int64, string, int) ([]Comment, *string, error)
	Create(context.Context, int64, string, []byte, CreateInput, time.Time) (Post, []int64, error)
	Get(context.Context, int64, int64) (Post, error)
	ListEvent(context.Context, int64, int64, int64, int) ([]Post, error)
	ListAuthor(context.Context, int64, int64, int) ([]Post, error)
	ListProfile(context.Context, int64, int64, int64, int) ([]Post, error)
	Feed(context.Context, int64, int64, int, FeedScope, string) ([]Post, error)
	Delete(context.Context, int64, int64) error
	SetLike(context.Context, int64, int64, bool) (*int64, error)
	HideFromFeed(context.Context, int64, int64) error
	ListLikes(context.Context, int64, int64, int) ([]User, error)
	ListComments(context.Context, int64, int64, int64, int) ([]Comment, error)
	CreateComment(context.Context, int64, int64, string, []int64, *int64, time.Time) (Comment, *int64, error)
	SetCommentLike(context.Context, int64, int64, bool) (*int64, error)
	UpdateComment(context.Context, int64, int64, string, []int64) error
	DeleteComment(context.Context, int64, int64) error
}

type Publisher interface {
	Publish(int64, string, any)
	Users() []int64
}

type Service struct {
	repository Repository
	publisher  Publisher
	now        func() time.Time
}

func NewService(repository Repository, publisher Publisher) *Service {
	return &Service{repository: repository, publisher: publisher, now: time.Now}
}

func (s *Service) Create(ctx context.Context, userID int64, idempotencyKey string, input CreateInput) (Post, error) {
	if input.CoverMS < 0 || input.CoverMS >= 180000 {
		return Post{}, ErrInvalidPost
	}
	if input.IsClip && (len(input.MediaIDs) != 1 || input.EventID != nil || input.RepostOfPostID != nil || (input.Visibility != "" && input.Visibility != "city")) {
		return Post{}, ErrInvalidPost
	}
	input.Caption = strings.TrimSpace(input.Caption)
	input.City = strings.TrimSpace(input.City)
	if input.Visibility == "" {
		input.Visibility = "city"
	}
	if input.EventID != nil {
		input.City = ""
	}
	if !idempotency.ValidKey(idempotencyKey) || userID <= 0 || (input.EventID != nil && *input.EventID <= 0) ||
		(input.RepostOfPostID != nil && *input.RepostOfPostID <= 0) ||
		(input.Visibility != "city" && input.Visibility != "friends" && input.Visibility != "event") ||
		(input.Visibility == "event" && input.EventID == nil) || (input.EventID == nil && input.City != "" && !fitsLength(input.City, 1, 80)) ||
		utf8.RuneCountInString(input.Caption) > 2000 ||
		(input.Caption == "" && len(input.MediaIDs) == 0 && input.RepostOfPostID == nil) || len(input.MediaIDs) > 10 ||
		len(input.TaggedUserIDs) > 20 || !uniqueIDs(input.MediaIDs, 0) ||
		!uniqueIDs(input.TaggedUserIDs, userID) {
		return Post{}, ErrInvalidPost
	}
	if input.EventID == nil && input.City == "" && input.RepostOfPostID == nil {
		return Post{}, ErrCityRequired
	}
	if err := contentpolicy.CheckTextLocal(input.Caption); err != nil {
		return Post{}, err
	}
	payload, _ := json.Marshal(input)
	hash := sha256.Sum256(payload)
	post, recipients, err := s.repository.Create(ctx, userID, idempotencyKey, hash[:], input, s.now())
	if err != nil {
		return Post{}, err
	}
	if len(recipients) == 0 {
		return post, nil
	}
	if publisher, ok := s.publisher.(interface{ Broadcast(string) }); ok {
		publisher.Broadcast("post.created")
	} else {
		s.publishChange(ctx, post.ID, 0, "post.created")
	}
	if publisher, ok := s.publisher.(interface{ PublishMany([]int64, string, any) }); ok {
		publisher.PublishMany(recipients, "notification.created", map[string]int64{"post_id": post.ID})
	} else if s.publisher != nil {
		for _, id := range recipients {
			s.publisher.Publish(id, "notification.created", map[string]int64{"post_id": post.ID})
		}
	}
	return post, nil
}

func (s *Service) CreateForEvent(ctx context.Context, userID, eventID int64, idempotencyKey string, input CreateInput) (Post, error) {
	input.EventID = &eventID
	input.Visibility = "event"
	return s.Create(ctx, userID, idempotencyKey, input)
}

func (s *Service) Get(ctx context.Context, userID, postID int64) (Post, error) {
	if userID <= 0 || postID <= 0 {
		return Post{}, ErrNotFound
	}
	return s.repository.Get(ctx, userID, postID)
}

func (s *Service) ListEvent(ctx context.Context, userID, eventID, beforeID int64) ([]Post, error) {
	if eventID <= 0 || beforeID < 0 {
		return nil, ErrInvalidPost
	}
	return s.repository.ListEvent(ctx, userID, eventID, beforeID, 50)
}

func (s *Service) ListAuthor(ctx context.Context, userID, beforeID int64) ([]Post, error) {
	if userID <= 0 || beforeID < 0 {
		return nil, ErrInvalidPost
	}
	return s.repository.ListAuthor(ctx, userID, beforeID, 50)
}

func (s *Service) ListProfile(ctx context.Context, viewerID, targetID, beforeID int64) ([]Post, error) {
	if viewerID <= 0 || targetID <= 0 || beforeID < 0 {
		return nil, ErrInvalidPost
	}
	return s.repository.ListProfile(ctx, viewerID, targetID, beforeID, 50)
}

func (s *Service) ListTagged(ctx context.Context, viewerID, targetID, beforeID int64) ([]Post, error) {
	if viewerID <= 0 || targetID <= 0 || beforeID < 0 {
		return nil, ErrInvalidPost
	}
	return s.repository.ListTagged(ctx, viewerID, targetID, beforeID, 50)
}

func (s *Service) Feed(ctx context.Context, userID, beforeID int64) ([]Post, error) {
	if userID <= 0 || beforeID < 0 {
		return nil, ErrInvalidPost
	}
	return s.repository.Feed(ctx, userID, beforeID, 50, FeedScopeAll, "")
}

func (s *Service) FeedScoped(ctx context.Context, userID, beforeID int64, scope FeedScope, city string) ([]Post, error) {
	city = strings.TrimSpace(city)
	if scope == FeedScopeCity && city == "" {
		return nil, ErrCityRequired
	}
	if userID <= 0 || beforeID < 0 || !scope.Valid() || (scope == FeedScopeCity && !fitsLength(city, 1, 80)) {
		return nil, ErrInvalidPost
	}
	return s.repository.Feed(ctx, userID, beforeID, 50, scope, city)
}

func (s *Service) Delete(ctx context.Context, userID, postID int64) error {
	if userID <= 0 || postID <= 0 {
		return ErrNotFound
	}
	viewers := s.viewers(ctx, postID)
	post, _ := s.repository.Get(ctx, userID, postID)
	if err := s.repository.Delete(ctx, userID, postID); err != nil {
		return err
	}
	s.publishTo(viewers, Change{PostID: postID}, "post.deleted")
	if post.RepostOfPostID != nil {
		// Counts and the viewer's repost state belong to the original and all
		// its repost cards, including cards open in another tab or client.
		if publisher, ok := s.publisher.(interface{ Broadcast(string) }); ok {
			publisher.Broadcast("post.updated")
		} else {
			s.publishChange(ctx, *post.RepostOfPostID, 0, "post.updated")
		}
	}
	return nil
}

func (s *Service) SetLike(ctx context.Context, userID, postID int64, liked bool) error {
	if userID <= 0 || postID <= 0 {
		return ErrNotFound
	}
	recipientID, err := s.repository.SetLike(ctx, userID, postID, liked)
	if err == nil && recipientID != nil && s.publisher != nil {
		s.publisher.Publish(*recipientID, "notification.created", map[string]int64{"post_id": postID})
	}
	if err == nil {
		s.publishChange(ctx, postID, 0, "post.updated")
	}
	return err
}

func (s *Service) ListLikes(ctx context.Context, userID, postID int64) ([]User, error) {
	if userID <= 0 || postID <= 0 {
		return nil, ErrNotFound
	}
	return s.repository.ListLikes(ctx, userID, postID, 100)
}

func (s *Service) ListComments(ctx context.Context, userID, postID, beforeID int64) ([]Comment, error) {
	if userID <= 0 || postID <= 0 || beforeID < 0 {
		return nil, ErrInvalidComment
	}
	return s.repository.ListComments(ctx, userID, postID, beforeID, 50)
}

func (s *Service) CreateComment(ctx context.Context, userID, postID int64, body string, mediaIDs []int64, parentCommentID *int64) (Comment, error) {
	body = strings.TrimSpace(body)
	if userID <= 0 || postID <= 0 || !validCommentContent(body, mediaIDs) || (parentCommentID != nil && *parentCommentID <= 0) {
		return Comment{}, ErrInvalidComment
	}
	analysis, err := contentpolicy.AnalyzeDiscussionText(ctx, body)
	if err != nil {
		return Comment{}, err
	}
	ctx = contentpolicy.WithDiscussionAnalysis(ctx, body, analysis)
	comment, recipientID, err := s.repository.CreateComment(ctx, userID, postID, body, mediaIDs, parentCommentID, s.now())
	if err == nil {
		if recipientID != nil && s.publisher != nil {
			s.publisher.Publish(*recipientID, "notification.created", map[string]int64{"post_id": postID})
		}
		s.publishChange(ctx, postID, comment.ID, "post.comment_created")
	}
	return comment, err
}

func (s *Service) UpdateComment(ctx context.Context, userID, commentID int64, body string, mediaIDs []int64) error {
	body = strings.TrimSpace(body)
	if userID <= 0 || commentID <= 0 || !validCommentContent(body, mediaIDs) {
		return ErrInvalidComment
	}
	analysis, err := contentpolicy.AnalyzeDiscussionText(ctx, body)
	if err != nil {
		return err
	}
	ctx = contentpolicy.WithDiscussionAnalysis(ctx, body, analysis)
	postID, err := s.repository.CommentPost(ctx, userID, commentID)
	if err != nil {
		return err
	}
	if err := s.repository.UpdateComment(ctx, userID, commentID, body, mediaIDs); err != nil {
		return err
	}
	s.publishChange(ctx, postID, commentID, "post.comment_updated")
	return nil
}

func validCommentContent(body string, mediaIDs []int64) bool {
	return utf8.RuneCountInString(body) <= 1000 &&
		(body != "" || len(mediaIDs) > 0) &&
		len(mediaIDs) <= 4 &&
		uniqueIDs(mediaIDs, 0)
}

func (s *Service) DeleteComment(ctx context.Context, userID, commentID int64) error {
	if userID <= 0 || commentID <= 0 {
		return ErrNotFound
	}
	postID, err := s.repository.CommentPost(ctx, userID, commentID)
	if err != nil {
		return err
	}
	if err := s.repository.DeleteComment(ctx, userID, commentID); err != nil {
		return err
	}
	s.publishChange(ctx, postID, commentID, "post.comment_deleted")
	return nil
}

func (s *Service) SetCommentLike(ctx context.Context, userID, commentID int64, liked bool) error {
	if userID <= 0 || commentID <= 0 {
		return ErrNotFound
	}
	postID, err := s.repository.CommentPost(ctx, userID, commentID)
	if err != nil {
		return err
	}
	recipientID, err := s.repository.SetCommentLike(ctx, userID, commentID, liked)
	if err != nil {
		return err
	}
	if recipientID != nil && s.publisher != nil {
		s.publisher.Publish(*recipientID, "notification.created", map[string]int64{"post_id": postID})
	}
	s.publishChange(ctx, postID, commentID, "post.comment_updated")
	return nil
}

func fitsLength(value string, min, max int) bool {
	length := utf8.RuneCountInString(value)
	return length >= min && length <= max
}

func uniqueIDs(values []int64, excluded int64) bool {
	seen := make(map[int64]struct{}, len(values))
	for _, value := range values {
		if value <= 0 || value == excluded {
			return false
		}
		if _, exists := seen[value]; exists {
			return false
		}
		seen[value] = struct{}{}
	}
	return true
}
