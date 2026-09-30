package httpapi

import (
	"context"
	"io"
	dating "kutezh/dating"
	"os"

	"kutezh/backend/internal/attendance"
	"kutezh/backend/internal/events"
	"kutezh/backend/internal/games"
	"kutezh/backend/internal/groups"
	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/media"
	"kutezh/backend/internal/moderation"
	"kutezh/backend/internal/notifications"
	"kutezh/backend/internal/organizers"
	"kutezh/backend/internal/posts"
	"kutezh/backend/internal/realtime"
	"kutezh/backend/internal/rewards"
	"kutezh/backend/internal/social"
	"kutezh/backend/internal/users"
	"kutezh/backend/internal/verification"
)

type FeatureServices struct {
	Clips         *posts.ClipService
	Games         *games.Service
	Dating        *dating.Service
	Media         mediaService
	Posts         postService
	Attendance    attendanceService
	Notifications notificationService
	Realtime      realtimeService
	Rewards       rewardService
	Organizers    organizerService
	Moderation    *moderation.Service
	Verification  *verification.Service
}

type userService interface {
	UpsertFromProvider(context.Context, users.AuthProvider, maxauth.User) (users.Profile, error)
	Get(context.Context, int64) (users.Profile, error)
	GetPublic(context.Context, int64, int64) (users.PublicProfileDetails, error)
	TouchPresence(context.Context, int64) error
	SetAvatar(context.Context, int64, *int64) (users.Profile, error)
	AddAvatar(context.Context, int64, int64) (users.Profile, error)
	SetAvatarCrop(context.Context, int64, int64, int64) (users.Profile, error)
	RemoveAvatar(context.Context, int64, int64) (users.Profile, error)
	ReorderAvatars(context.Context, int64, []int64) (users.Profile, error)
	Update(context.Context, int64, users.Update) (users.Profile, error)
	Search(context.Context, int64, string) ([]users.PublicProfile, error)
	Suggestions(context.Context, int64) ([]users.Suggestion, error)
}

type eventService interface {
	Activity(context.Context, int64) (events.Activity, error)
	Create(context.Context, int64, string, string, events.CreateInput) (events.Event, error)
	Update(context.Context, int64, int64, events.CreateInput) (events.Event, error)
	Delete(context.Context, int64, int64) error
	List(context.Context, events.Filter) ([]events.Event, error)
	Get(context.Context, int64) (events.Event, error)
	Categories(context.Context) ([]events.Category, error)
	Recommendations(context.Context, int64) ([]events.Recommendation, error)
	Participants(context.Context, int64, int64) ([]events.Participant, error)
	Nearby(context.Context, events.NearbyQuery) ([]events.NearbyEvent, error)
	Viewport(context.Context, events.ViewportQuery) (events.ViewportPage, error)
	SetParticipation(context.Context, int64, int64, bool) error
	SetSaved(context.Context, int64, int64, bool) error
	History(context.Context, int64, events.HistoryView) ([]events.HistoryItem, error)
	ProfileEvents(context.Context, int64, int64, int64) ([]events.HistoryItem, error)
}

type socialService interface {
	SendFriendRequest(context.Context, int64, int64) error
	ListFriendRequests(context.Context, int64) ([]social.FriendRequest, error)
	ListOutgoingFriendRequests(context.Context, int64) ([]social.FriendRequest, error)
	ResolveFriendRequest(context.Context, int64, int64, bool) error
	ListFriends(context.Context, int64, *social.FriendCursor) (social.FriendPage, error)
	ListPublicFriends(context.Context, int64, int64, *social.FriendCursor) (social.FriendPage, error)
	DirectMessageTarget(context.Context, int64, int64) (social.DirectMessageTarget, error)
	RemoveFriend(context.Context, int64, int64) error
	Block(context.Context, int64, int64) error
	Unblock(context.Context, int64, int64) error
	ListBlocked(context.Context, int64) ([]social.BlockedUser, error)
	InviteToEvent(context.Context, int64, int64, int64) error
	ListEventInvitations(context.Context, int64) ([]social.EventInvitation, error)
	ResolveEventInvitation(context.Context, int64, int64, int64, bool) error
}

type groupService interface {
	Create(context.Context, int64, int64, string, groups.CreateInput) (groups.Group, error)
	List(context.Context, int64, int64) ([]groups.Group, error)
	ListMembers(context.Context, int64, int64) ([]groups.Member, error)
	Update(context.Context, int64, int64, groups.UpdateInput) error
	RemoveMember(context.Context, int64, int64, int64) error
	TransferLeadership(context.Context, int64, int64, int64) error
	Join(context.Context, int64, int64) error
	Leave(context.Context, int64, int64) error
	RequestJoin(context.Context, int64, int64) error
	ListRequests(context.Context, int64, int64) ([]groups.Candidate, error)
	ResolveRequest(context.Context, int64, int64, int64, bool) error
	Invite(context.Context, int64, int64, int64) error
	ListInvitations(context.Context, int64) ([]groups.Invitation, error)
	ResolveInvitation(context.Context, int64, int64, bool) error
	RequestMerge(context.Context, int64, int64, int64) error
	ListMergeRequests(context.Context, int64, int64) ([]groups.MergeRequest, error)
	ResolveMerge(context.Context, int64, int64, int64, bool) error
}

type mediaService interface {
	Upload(context.Context, int64, io.Reader) (media.Asset, error)
	UploadAvatar(context.Context, int64, io.Reader) (media.Asset, error)
	UploadVideo(context.Context, int64, io.Reader) (media.Asset, error)
	UploadModeratedImage(context.Context, int64, io.Reader, bool) (media.Asset, error)
	UploadModeratedVideo(context.Context, int64, io.Reader) (media.Asset, error)
	Open(context.Context, int64, int64) (media.Asset, *os.File, error)
	Delete(context.Context, int64, int64) error
}

type postService interface {
	ListByIDs(context.Context, int64, []int64) ([]posts.Post, error)
	CommentsByIDs(context.Context, int64, int64, []int64) ([]posts.Comment, error)
	Create(context.Context, int64, string, posts.CreateInput) (posts.Post, error)
	CreateForEvent(context.Context, int64, int64, string, posts.CreateInput) (posts.Post, error)
	Get(context.Context, int64, int64) (posts.Post, error)
	ListEvent(context.Context, int64, int64, int64) ([]posts.Post, error)
	ListAuthor(context.Context, int64, int64) ([]posts.Post, error)
	ListProfile(context.Context, int64, int64, int64) ([]posts.Post, error)
	Feed(context.Context, int64, int64) ([]posts.Post, error)
	FeedScoped(context.Context, int64, int64, posts.FeedScope, string) ([]posts.Post, error)
	RankedFeed(context.Context, int64, string) ([]posts.Post, *string, error)
	Delete(context.Context, int64, int64) error
	SetLike(context.Context, int64, int64, bool) error
	HideFromFeed(context.Context, int64, int64) error
	ListLikes(context.Context, int64, int64) ([]posts.User, error)
	ListComments(context.Context, int64, int64, int64) ([]posts.Comment, error)
	RankedComments(context.Context, int64, int64, string) ([]posts.Comment, *string, error)
	CreateComment(context.Context, int64, int64, string, []int64, *int64) (posts.Comment, error)
	SetCommentLike(context.Context, int64, int64, bool) error
	UpdateComment(context.Context, int64, int64, string, []int64) error
	DeleteComment(context.Context, int64, int64) error
}

type attendanceService interface {
	Submit(context.Context, int64, int64, attendance.EvidenceInput) (attendance.Confirmation, error)
	Get(context.Context, int64, int64) (attendance.Confirmation, error)
	ListForOrganizer(context.Context, int64, int64) ([]attendance.Confirmation, error)
	Review(context.Context, int64, int64, int64, attendance.ReviewInput) (attendance.Confirmation, error)
}

type notificationService interface {
	Counts(context.Context, int64) (notifications.Counts, error)
	List(context.Context, int64, bool, int64) (notifications.Page, error)
	MarkRead(context.Context, int64, int64) error
	MarkAllRead(context.Context, int64) error
	MarkMatchesRead(context.Context, int64) error
}

type realtimeService interface {
	Subscribe(int64) (<-chan realtime.Event, func())
}

type rewardService interface {
	Wallet(context.Context, int64) (rewards.Wallet, error)
	Transactions(context.Context, int64, int64) ([]rewards.Transaction, error)
	Achievements(context.Context, int64) ([]rewards.Achievement, error)
	Items(context.Context) ([]rewards.Item, error)
	Purchase(context.Context, int64, rewards.PurchaseInput) (rewards.Purchase, error)
	SetDecoration(context.Context, int64, string) error
	SendGift(context.Context, int64, int64, rewards.GiftInput) (rewards.Gift, error)
	Gifts(context.Context, int64, int64) ([]rewards.Gift, error)
}

type organizerService interface {
	Create(context.Context, int64, organizers.Input) (organizers.Profile, error)
	ListOwned(context.Context, int64) ([]organizers.Profile, error)
	Get(context.Context, int64) (organizers.Profile, error)
	Update(context.Context, int64, int64, organizers.Input) (organizers.Profile, error)
	Review(context.Context, int64, int64, organizers.Status) (organizers.Profile, error)
	ListForReview(context.Context, int64, organizers.Status) ([]organizers.Profile, error)
	CreateEvent(context.Context, int64, int64, events.CreateInput) (events.Event, error)
}
