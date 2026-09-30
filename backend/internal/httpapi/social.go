package httpapi

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"kutezh/backend/internal/events"
	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/moderation"
	"kutezh/backend/internal/rewards"
	"kutezh/backend/internal/social"
	"kutezh/backend/internal/users"
)

type friendsResponse struct {
	Friends        []social.Friend `json:"friends"`
	BirthdaysToday []social.Friend `json:"birthdays_today,omitempty"`
	NextCursor     string          `json:"next_cursor,omitempty"`
	TotalCount     *int64          `json:"total_count,omitempty"`
}

func parseFriendCursor(raw string) (*social.FriendCursor, bool) {
	if raw == "" {
		return nil, true
	}
	if len(raw) > 128 {
		return nil, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, false
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 2 {
		return nil, false
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, false
	}
	userID, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || userID <= 0 {
		return nil, false
	}
	return &social.FriendCursor{CreatedAt: createdAt, UserID: userID}, true
}

func encodeFriendCursor(cursor *social.FriendCursor) string {
	if cursor == nil {
		return ""
	}
	value := cursor.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + strconv.FormatInt(cursor.UserID, 10)
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

type friendRequestsResponse struct {
	Requests []social.FriendRequest `json:"requests"`
}

type blocksResponse struct {
	Users []social.BlockedUser `json:"users"`
}

type eventInvitationsResponse struct {
	Invitations []social.EventInvitation `json:"invitations"`
}

type socialEventInviteRequest struct {
	UserID int64 `json:"user_id"`
}

type userReportRequest struct {
	Reason string `json:"reason"`
}

func handleFriends(authService *maxauth.Service, service socialService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		values := r.URL.Query()
		if len(values) > 1 || len(values["cursor"]) > 1 || (len(values) == 1 && !values.Has("cursor")) {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор друзей")
			return
		}
		before, valid := parseFriendCursor(values.Get("cursor"))
		if !valid {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор друзей")
			return
		}
		page, err := service.ListFriends(r.Context(), userID, before)
		if writeSocialError(w, err) {
			return
		}
		birthdays := []social.Friend{}
		if birthdayService, ok := service.(interface {
			BirthdaysToday(context.Context, int64) ([]social.Friend, error)
		}); ok {
			birthdays, err = birthdayService.BirthdaysToday(r.Context(), userID)
			if writeSocialError(w, err) {
				return
			}
		}
		writeJSON(w, http.StatusOK, friendsResponse{
			Friends: page.Friends, BirthdaysToday: birthdays,
			NextCursor: encodeFriendCursor(page.NextCursor), TotalCount: &page.TotalCount,
		})
	}
}

func handleFriendRequests(authService *maxauth.Service, service socialService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		values := r.URL.Query()
		if len(values) > 1 || len(values["direction"]) > 1 {
			writeError(w, http.StatusBadRequest, "invalid_friend_request_direction", "Выберите список заявок")
			return
		}
		var items []social.FriendRequest
		var err error
		switch values.Get("direction") {
		case "", "incoming":
			items, err = service.ListFriendRequests(r.Context(), userID)
		case "outgoing":
			items, err = service.ListOutgoingFriendRequests(r.Context(), userID)
		default:
			writeError(w, http.StatusBadRequest, "invalid_friend_request_direction", "Выберите список заявок")
			return
		}
		if writeSocialError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, friendRequestsResponse{Requests: items})
	}
}

func handleBlocks(authService *maxauth.Service, service socialService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		items, err := service.ListBlocked(r.Context(), userID)
		if writeSocialError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, blocksResponse{Users: items})
	}
}

func handleEventInvitations(authService *maxauth.Service, service socialService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		items, err := service.ListEventInvitations(r.Context(), userID)
		if writeSocialError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, eventInvitationsResponse{Invitations: items})
	}
}

func handleUserSocial(
	authService *maxauth.Service,
	userService userService,
	eventService eventService,
	service socialService,
	postService postService,
	rewardService rewardService,
	moderationService *moderation.Service,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/users/"), "/")
		parts := strings.Split(path, "/")
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		if len(parts) == 1 && parts[0] != "me" {
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			targetID, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil || targetID <= 0 {
				handleNotFound(w, r)
				return
			}
			profile, err := userService.GetPublic(r.Context(), userID, targetID)
			switch {
			case errors.Is(err, users.ErrNotFound):
				writeError(w, http.StatusNotFound, "not_found", "Профиль не найден")
			case err != nil:
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить профиль")
			default:
				writeJSON(w, http.StatusOK, profile)
			}
			return
		}
		if len(parts) == 2 && parts[0] != "me" && parts[1] == "posts" && postService != nil {
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			targetID, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil || targetID <= 0 {
				handleNotFound(w, r)
				return
			}
			publicProfile, err := userService.GetPublic(r.Context(), userID, targetID)
			if err != nil {
				if errors.Is(err, users.ErrNotFound) {
					writeError(w, http.StatusNotFound, "not_found", "Профиль не найден")
				} else {
					writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить профиль")
				}
				return
			}
			if publicProfile.Restricted {
				writeError(w, http.StatusForbidden, "private_profile", "Публикации доступны только друзьям")
				return
			}
			beforeID, ok := parseCursor(r, "view")
			if !ok {
				writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор публикаций")
				return
			}
			values := r.URL.Query()
			view := values.Get("view")
			if len(values["view"]) > 1 || (view != "" && view != "tagged") {
				writeError(w, http.StatusBadRequest, "invalid_post_view", "Выберите раздел публикаций")
				return
			}
			if view == "tagged" {
				tagged, supported := postService.(taggedPostService)
				if !supported {
					writeError(w, http.StatusInternalServerError, "internal_error", "Отметки временно недоступны")
					return
				}
				items, err := tagged.ListTagged(r.Context(), userID, targetID, beforeID)
				writePostsResult(w, items, err)
				return
			}
			items, err := postService.ListProfile(r.Context(), userID, targetID, beforeID)
			writePostsResult(w, items, err)
			return
		}
		if len(parts) == 2 && parts[0] != "me" && parts[1] == "friends" {
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			targetID, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil || targetID <= 0 {
				handleNotFound(w, r)
				return
			}
			values := r.URL.Query()
			if len(values) > 1 || len(values["cursor"]) > 1 || (len(values) == 1 && !values.Has("cursor")) {
				writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор друзей")
				return
			}
			before, valid := parseFriendCursor(values.Get("cursor"))
			if !valid {
				writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор друзей")
				return
			}
			publicProfile, err := userService.GetPublic(r.Context(), userID, targetID)
			if err != nil {
				if errors.Is(err, users.ErrNotFound) {
					writeError(w, http.StatusNotFound, "not_found", "Профиль не найден")
				} else {
					writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить профиль")
				}
				return
			}
			if publicProfile.Restricted {
				writeError(w, http.StatusForbidden, "private_profile", "Друзья доступны только друзьям")
				return
			}
			page, err := service.ListPublicFriends(r.Context(), userID, targetID, before)
			if writeSocialError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, friendsResponse{Friends: page.Friends, NextCursor: encodeFriendCursor(page.NextCursor)})
			return
		}
		if len(parts) == 2 && parts[0] != "me" && parts[1] == "events" {
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			targetID, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil || targetID <= 0 {
				handleNotFound(w, r)
				return
			}
			publicProfile, err := userService.GetPublic(r.Context(), userID, targetID)
			if err != nil || publicProfile.Restricted {
				writeError(w, http.StatusForbidden, "private_profile", "Мероприятия доступны только друзьям")
				return
			}
			beforeID, ok := parseCursor(r)
			if !ok {
				writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор мероприятий")
				return
			}
			items, err := eventService.ProfileEvents(r.Context(), userID, targetID, beforeID)
			switch {
			case errors.Is(err, events.ErrNotFound):
				writeError(w, http.StatusNotFound, "not_found", "Профиль не найден")
			case errors.Is(err, events.ErrInvalidFilter):
				writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор мероприятий")
			case err != nil:
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить мероприятия")
			default:
				writeJSON(w, http.StatusOK, eventHistoryResponse{Events: items})
			}
			return
		}
		if len(parts) == 4 && parts[0] == "me" && parts[1] == "friends" && parts[3] == "direct-message" {
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			targetID, err := strconv.ParseInt(parts[2], 10, 64)
			if err != nil || targetID <= 0 {
				handleNotFound(w, r)
				return
			}
			target, err := service.DirectMessageTarget(r.Context(), userID, targetID)
			if errors.Is(err, social.ErrFriendshipRequired) {
				writeError(w, http.StatusForbidden, "friendship_required", "Чат доступен только друзьям")
				return
			}
			if writeSocialError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, target)
			return
		}

		var targetID int64
		var action string
		var targetErr error
		switch {
		case len(parts) == 2 && parts[0] != "me":
			targetID, targetErr = strconv.ParseInt(parts[0], 10, 64)
			action = parts[1]
		case len(parts) == 3 && parts[0] == "me":
			targetID, targetErr = strconv.ParseInt(parts[2], 10, 64)
			action = parts[1]
		default:
			handleNotFound(w, r)
			return
		}
		if targetErr != nil || targetID <= 0 {
			handleNotFound(w, r)
			return
		}

		var err error
		switch {
		case parts[0] != "me" && action == "follow":
			if !allowMethods(w, r, http.MethodGet, http.MethodPut, http.MethodDelete) {
				return
			}
			follows, ok := service.(interface {
				SetFollowing(context.Context, int64, int64, bool) error
				FollowState(context.Context, int64, int64) (social.FollowState, error)
			})
			if !ok {
				writeError(w, 503, "unavailable", "Подписки временно недоступны")
				return
			}
			if r.Method == http.MethodGet {
				state, stateErr := follows.FollowState(r.Context(), userID, targetID)
				if writeSocialError(w, stateErr) {
					return
				}
				writeJSON(w, 200, state)
				return
			}
			err = follows.SetFollowing(r.Context(), userID, targetID, r.Method == http.MethodPut)
		case parts[0] != "me" && action == "gifts" && rewardService != nil:
			if !allowMethods(w, r, http.MethodGet, http.MethodPost) {
				return
			}
			if r.Method == http.MethodGet {
				publicProfile, profileErr := userService.GetPublic(r.Context(), userID, targetID)
				if profileErr != nil {
					if errors.Is(profileErr, users.ErrNotFound) {
						writeError(w, http.StatusNotFound, "not_found", "Профиль не найден")
					} else {
						writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить профиль")
					}
					return
				}
				if publicProfile.Restricted {
					writeError(w, http.StatusForbidden, "private_profile", "Подарки доступны только друзьям")
					return
				}
				beforeID, valid := parseCursor(r)
				if !valid {
					writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор подарков")
					return
				}
				items, giftErr := rewardService.Gifts(r.Context(), targetID, beforeID)
				if writeRewardError(w, giftErr) {
					return
				}
				var next *int64
				if len(items) == 50 {
					value := items[len(items)-1].ID
					next = &value
				}
				writeJSON(w, http.StatusOK, giftsResponse{Gifts: items, NextCursor: next})
				return
			}
			var input rewards.GiftInput
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_gift", "Проверьте данные подарка")
				return
			}
			gift, giftErr := rewardService.SendGift(r.Context(), userID, targetID, input)
			if writeRewardError(w, giftErr) {
				return
			}
			writeJSON(w, http.StatusCreated, gift)
			return
		case parts[0] != "me" && action == "friend-requests":
			if !allowMethods(w, r, http.MethodPost, http.MethodDelete) {
				return
			}
			if r.Method == http.MethodPost {
				err = service.SendFriendRequest(r.Context(), userID, targetID)
			} else {

				err = service.ResolveFriendRequest(r.Context(), targetID, userID, false)
			}
		case parts[0] != "me" && action == "report":
			if !allowMethods(w, r, http.MethodPost) {
				return
			}
			if moderationService == nil {
				writeError(w, http.StatusServiceUnavailable, "moderation_unavailable", "Жалобы временно недоступны")
				return
			}
			var input userReportRequest
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_report", "Опишите причину жалобы")
				return
			}
			if userID == targetID {
				writeError(w, http.StatusBadRequest, "invalid_user", "Нельзя пожаловаться на себя")
				return
			}
			_, reportErr := moderationService.CreateReport(r.Context(), userID, moderation.ReportInput{
				TargetType: moderation.TargetUser, TargetID: targetID, Reason: input.Reason,
			})
			if writeModerationError(w, reportErr) {
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case parts[0] != "me" && action == "block":
			if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
				return
			}
			if r.Method == http.MethodPut {
				err = service.Block(r.Context(), userID, targetID)
			} else {
				err = service.Unblock(r.Context(), userID, targetID)
			}
		case parts[0] == "me" && action == "friend-requests":
			if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
				return
			}
			err = service.ResolveFriendRequest(r.Context(), userID, targetID, r.Method == http.MethodPut)
		case parts[0] == "me" && action == "friends":
			if !allowMethods(w, r, http.MethodDelete) {
				return
			}
			err = service.RemoveFriend(r.Context(), userID, targetID)
		default:
			handleNotFound(w, r)
			return
		}
		if writeSocialError(w, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleSendEventInvitation(
	w http.ResponseWriter,
	r *http.Request,
	authService *maxauth.Service,
	service socialService,
	eventID int64,
) {
	if !allowMethods(w, r, http.MethodPost) {
		return
	}
	userID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}
	var input socialEventInviteRequest
	if decodeJSON(w, r, &input) != nil || input.UserID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_request", "Укажите друга для приглашения")
		return
	}
	if writeSocialError(w, service.InviteToEvent(r.Context(), userID, eventID, input.UserID)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func handleResolveEventInvitation(
	w http.ResponseWriter,
	r *http.Request,
	authService *maxauth.Service,
	service socialService,
	eventID int64,
	senderValue string,
) {
	if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
		return
	}
	senderID, err := strconv.ParseInt(senderValue, 10, 64)
	if err != nil || senderID <= 0 {
		handleNotFound(w, r)
		return
	}
	userID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}
	err = service.ResolveEventInvitation(r.Context(), userID, eventID, senderID, r.Method == http.MethodPut)
	if writeSocialError(w, err) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeSocialError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, social.ErrInvalidUser):
		writeError(w, http.StatusBadRequest, "invalid_user", "Нельзя выполнить это действие с выбранным пользователем")
	case errors.Is(err, social.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Пользователь, заявка или приглашение не найдены")
	case errors.Is(err, social.ErrBlocked):
		writeError(w, http.StatusForbidden, "user_blocked", "Действие недоступно из-за блокировки")
	case errors.Is(err, social.ErrAlreadyFriends):
		writeError(w, http.StatusConflict, "already_friends", "Вы уже друзья")
	case errors.Is(err, social.ErrRequestExists):
		writeError(w, http.StatusConflict, "friend_request_exists", "Входящая заявка уже ожидает ответа")
	case errors.Is(err, social.ErrFriendshipRequired):
		writeError(w, http.StatusForbidden, "friendship_required", "Приглашать на мероприятие можно только друзей")
	case errors.Is(err, social.ErrParticipationRequired):
		writeError(w, http.StatusForbidden, "event_participation_required", "Сначала отметьте «Хочу пойти»")
	case errors.Is(err, social.ErrAlreadyParticipating):
		writeError(w, http.StatusConflict, "already_participating", "Друг уже собирается на это мероприятие")
	case errors.Is(err, social.ErrEventEnded):
		writeError(w, http.StatusConflict, "event_ended", "Мероприятие уже завершилось")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось выполнить социальное действие")
	}
	return true
}
