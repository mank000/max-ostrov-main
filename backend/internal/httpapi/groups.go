package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"kutezh/backend/internal/groups"
	"kutezh/backend/internal/maxauth"
)

type groupListResponse struct {
	Groups []groups.Group `json:"groups"`
}

type groupMembersResponse struct {
	Members []groups.Member `json:"members"`
}

type groupRequestsResponse struct {
	Requests []groups.Candidate `json:"requests"`
}

type groupInvitationsResponse struct {
	Invitations []groups.Invitation `json:"invitations"`
}

type groupMergeRequestsResponse struct {
	Requests []groups.MergeRequest `json:"requests"`
}

type inviteRequest struct {
	UserID int64 `json:"user_id"`
}

type mergeRequest struct {
	TargetGroupID int64 `json:"target_group_id"`
}

type leadershipRequest struct {
	UserID int64 `json:"user_id"`
}

func handleEventGroups(
	w http.ResponseWriter,
	r *http.Request,
	authService *maxauth.Service,
	groupService groupService,
	eventID int64,
) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodGet+", "+http.MethodPost)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Метод не поддерживается")
		return
	}
	userID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}

	if r.Method == http.MethodGet {
		items, err := groupService.List(r.Context(), userID, eventID)
		if writeGroupError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, groupListResponse{Groups: items})
		return
	}

	var input groups.CreateInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Некорректные данные группы")
		return
	}
	idempotencyKey, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	group, err := groupService.Create(r.Context(), userID, eventID, idempotencyKey, input)
	if writeGroupError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, group)
}

func handleGroup(authService *maxauth.Service, groupService groupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/groups/"), "/")
		parts := strings.Split(path, "/")
		if len(parts) < 1 || parts[0] == "" {
			handleNotFound(w, r)
			return
		}
		groupID, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || groupID <= 0 {
			handleNotFound(w, r)
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}

		switch {
		case len(parts) == 1:
			if !allowMethods(w, r, http.MethodPatch) {
				return
			}
			var input groups.UpdateInput
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_request", "Некорректные настройки группы")
				return
			}
			err = groupService.Update(r.Context(), userID, groupID, input)
		case len(parts) == 2 && parts[1] == "members":
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			items, listErr := groupService.ListMembers(r.Context(), userID, groupID)
			if writeGroupError(w, listErr) {
				return
			}
			writeJSON(w, http.StatusOK, groupMembersResponse{Members: items})
			return
		case len(parts) == 3 && parts[1] == "members":
			if !allowMethods(w, r, http.MethodDelete) {
				return
			}
			memberID, parseErr := strconv.ParseInt(parts[2], 10, 64)
			if parseErr != nil || memberID <= 0 {
				handleNotFound(w, r)
				return
			}
			err = groupService.RemoveMember(r.Context(), userID, groupID, memberID)
		case len(parts) == 2 && parts[1] == "leader":
			if !allowMethods(w, r, http.MethodPut) {
				return
			}
			var input leadershipRequest
			if decodeJSON(w, r, &input) != nil || input.UserID <= 0 {
				writeError(w, http.StatusBadRequest, "invalid_request", "Укажите нового лидера группы")
				return
			}
			err = groupService.TransferLeadership(r.Context(), userID, groupID, input.UserID)
		case len(parts) == 2 && parts[1] == "membership":
			if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
				return
			}
			if r.Method == http.MethodPut {
				err = groupService.Join(r.Context(), userID, groupID)
			} else {
				err = groupService.Leave(r.Context(), userID, groupID)
			}
		case len(parts) == 2 && parts[1] == "join-requests":
			if !allowMethods(w, r, http.MethodGet, http.MethodPost) {
				return
			}
			if r.Method == http.MethodGet {
				items, listErr := groupService.ListRequests(r.Context(), userID, groupID)
				if writeGroupError(w, listErr) {
					return
				}
				writeJSON(w, http.StatusOK, groupRequestsResponse{Requests: items})
				return
			}
			err = groupService.RequestJoin(r.Context(), userID, groupID)
		case len(parts) == 3 && parts[1] == "join-requests":
			if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
				return
			}
			candidateID, parseErr := strconv.ParseInt(parts[2], 10, 64)
			if parseErr != nil || candidateID <= 0 {
				handleNotFound(w, r)
				return
			}
			err = groupService.ResolveRequest(r.Context(), userID, groupID, candidateID, r.Method == http.MethodPut)
		case len(parts) == 2 && parts[1] == "invitations":
			if !allowMethods(w, r, http.MethodPost) {
				return
			}
			var input inviteRequest
			if decodeJSON(w, r, &input) != nil || input.UserID <= 0 {
				writeError(w, http.StatusBadRequest, "invalid_request", "Укажите участника для приглашения")
				return
			}
			err = groupService.Invite(r.Context(), userID, groupID, input.UserID)
		case len(parts) == 3 && parts[1] == "invitations" && parts[2] == "me":
			if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
				return
			}
			err = groupService.ResolveInvitation(r.Context(), userID, groupID, r.Method == http.MethodPut)
		case len(parts) == 2 && parts[1] == "merge-requests":
			if !allowMethods(w, r, http.MethodGet, http.MethodPost) {
				return
			}
			if r.Method == http.MethodGet {
				items, listErr := groupService.ListMergeRequests(r.Context(), userID, groupID)
				if writeGroupError(w, listErr) {
					return
				}
				writeJSON(w, http.StatusOK, groupMergeRequestsResponse{Requests: items})
				return
			}
			var input mergeRequest
			if decodeJSON(w, r, &input) != nil || input.TargetGroupID <= 0 {
				writeError(w, http.StatusBadRequest, "invalid_request", "Укажите группу для объединения")
				return
			}
			err = groupService.RequestMerge(r.Context(), userID, groupID, input.TargetGroupID)
		case len(parts) == 3 && parts[1] == "merge-requests":
			if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
				return
			}
			sourceID, parseErr := strconv.ParseInt(parts[2], 10, 64)
			if parseErr != nil || sourceID <= 0 {
				handleNotFound(w, r)
				return
			}
			err = groupService.ResolveMerge(r.Context(), userID, groupID, sourceID, r.Method == http.MethodPut)
		default:
			handleNotFound(w, r)
			return
		}
		if writeGroupError(w, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGroupInvitations(authService *maxauth.Service, groupService groupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodGet) {
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		items, err := groupService.ListInvitations(r.Context(), userID)
		if writeGroupError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, groupInvitationsResponse{Invitations: items})
	}
}

func allowMethods(w http.ResponseWriter, r *http.Request, methods ...string) bool {
	for _, method := range methods {
		if r.Method == method {
			return true
		}
	}
	w.Header().Set("Allow", strings.Join(methods, ", "))
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Метод не поддерживается")
	return false
}

func writeGroupError(w http.ResponseWriter, err error) bool {
	if writeContentPolicyError(w, err) {
		return true
	}
	switch {
	case err == nil:
		return false
	case errors.Is(err, groups.ErrInvalidGroup):
		writeError(w, http.StatusBadRequest, "invalid_group", "Проверьте название, вместимость и режим вступления")
	case errors.Is(err, groups.ErrInvalidChatLink):
		writeError(w, http.StatusBadRequest, "invalid_group_chat_link", "Укажите ссылку на чат MAX вида https://max.ru/…")
	case errors.Is(err, groups.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Группа или мероприятие не найдены")
	case errors.Is(err, groups.ErrNotParticipant):
		writeError(w, http.StatusForbidden, "event_participation_required", "Сначала отметьте «Хочу пойти»")
	case errors.Is(err, groups.ErrEventEnded):
		writeError(w, http.StatusConflict, "event_ended", "Мероприятие уже завершилось")
	case errors.Is(err, groups.ErrAlreadyInGroup):
		writeError(w, http.StatusConflict, "already_in_group", "Вы уже состоите в группе этого мероприятия")
	case errors.Is(err, groups.ErrGroupFull):
		writeError(w, http.StatusConflict, "group_full", "В группе больше нет свободных мест")
	case errors.Is(err, groups.ErrCapacityTooSmall):
		writeError(w, http.StatusConflict, "group_capacity_too_small", "Новый лимит меньше текущего числа участников")
	case errors.Is(err, groups.ErrCannotRemoveLeader):
		writeError(w, http.StatusConflict, "group_leader_cannot_be_removed", "Сначала передайте лидерство другому участнику")
	case errors.Is(err, groups.ErrForbidden):
		writeError(w, http.StatusForbidden, "group_leader_required", "Действие доступно только лидеру группы")
	case errors.Is(err, groups.ErrRequestRequired):
		writeError(w, http.StatusConflict, "join_request_required", "Для вступления отправьте заявку")
	case errors.Is(err, groups.ErrInvitationNeeded):
		writeError(w, http.StatusForbidden, "group_invitation_required", "Для вступления требуется приглашение")
	case errors.Is(err, groups.ErrInvalidMerge):
		writeError(w, http.StatusConflict, "groups_cannot_be_merged", "Эти группы нельзя объединить")
	case errors.Is(err, groups.ErrBlocked):
		writeError(w, http.StatusForbidden, "user_blocked", "Действие недоступно из-за блокировки")
	case errors.Is(err, groups.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "idempotency_key_reused", "Этот Idempotency-Key уже использован для другого запроса")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось обработать группу")
	}
	return true
}
