package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"kutezh/backend/internal/events"
	"kutezh/backend/internal/maxauth"
)

type eventListResponse struct {
	Events []events.Event `json:"events"`
}

type categoryListResponse struct {
	Categories []events.Category `json:"categories"`
}

type recommendationListResponse struct {
	Events []events.Recommendation `json:"events"`
}

type participantListResponse struct {
	Participants []events.Participant `json:"participants"`
}

type nearbyEventListResponse struct {
	Events []events.NearbyEvent `json:"events"`
}

type eventHistoryResponse struct {
	Events []events.HistoryItem `json:"events"`
}

func handleEvents(authService *maxauth.Service, userService userService, eventService eventService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			filter, ok := parseEventFilter(r)
			if !ok {
				writeError(w, http.StatusBadRequest, "invalid_event_filter", "Проверьте фильтры мероприятий")
				return
			}
			items, err := eventService.List(r.Context(), filter)
			if err != nil {
				if errors.Is(err, events.ErrInvalidFilter) {
					writeError(w, http.StatusBadRequest, "invalid_event_filter", "Проверьте фильтры мероприятий")
				} else {
					writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить мероприятия")
				}
				return
			}
			writeJSON(w, http.StatusOK, eventListResponse{Events: items})
		case http.MethodPost:
			userID, ok := authenticatedUserID(w, r, authService)
			if !ok {
				return
			}
			idempotencyKey, ok := requireIdempotencyKey(w, r)
			if !ok {
				return
			}
			profile, err := userService.Get(r.Context(), userID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось определить организатора")
				return
			}
			var input events.CreateInput
			if err := decodeJSON(w, r, &input); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_request", "Некорректные данные мероприятия")
				return
			}
			event, err := eventService.Create(r.Context(), userID, profile.DisplayName, idempotencyKey, input)
			switch {
			case writeContentPolicyError(w, err):
			case errors.Is(err, events.ErrUntrustedTicketURL):
				writeError(w, http.StatusBadRequest, "untrusted_ticket_url", "Ссылка на билеты должна вести на поддерживаемый билетный сервис")
			case errors.Is(err, events.ErrInvalidEvent):
				writeError(w, http.StatusBadRequest, "invalid_event", "Проверьте данные мероприятия")
			case errors.Is(err, events.ErrIdempotencyConflict):
				writeError(w, http.StatusConflict, "idempotency_key_reused", "Этот Idempotency-Key уже использован для другого запроса")
			case err != nil:
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось создать мероприятие")
			default:
				writeJSON(w, http.StatusCreated, event)
			}
		default:
			w.Header().Set("Allow", http.MethodGet+", "+http.MethodPost)
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Метод не поддерживается")
		}
	}
}

func handleEventCategories(eventService eventService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := eventService.Categories(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить категории")
			return
		}
		writeJSON(w, http.StatusOK, categoryListResponse{Categories: items})
	}
}

func handleEventRecommendations(authService *maxauth.Service, eventService eventService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		items, err := eventService.Recommendations(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось подобрать мероприятия")
			return
		}
		writeJSON(w, http.StatusOK, recommendationListResponse{Events: items})
	}
}

func handleNearbyEvents(eventService eventService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query, ok := parseNearbyQuery(r)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_geo_query", "Проверьте координаты и радиус поиска")
			return
		}
		items, err := eventService.Nearby(r.Context(), query)
		switch {
		case errors.Is(err, events.ErrInvalidGeoQuery):
			writeError(w, http.StatusBadRequest, "invalid_geo_query", "Проверьте координаты и радиус поиска")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось найти мероприятия рядом")
		default:
			writeJSON(w, http.StatusOK, nearbyEventListResponse{Events: items})
		}
	}
}

func handleViewportEvents(eventService eventService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query, ok := parseViewportQuery(r)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_geo_query", "Проверьте границы карты")
			return
		}
		page, err := eventService.Viewport(r.Context(), query)
		switch {
		case errors.Is(err, events.ErrInvalidGeoQuery):
			writeError(w, http.StatusBadRequest, "invalid_geo_query", "Проверьте границы карты")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось загрузить мероприятия на карте")
		default:
			writeJSON(w, http.StatusOK, page)
		}
	}
}

func handleUserEvents(authService *maxauth.Service, eventService eventService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Метод не поддерживается")
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}

		values := r.URL.Query()
		for key := range values {
			if key != "view" {
				writeError(w, http.StatusBadRequest, "invalid_history_view", "Неизвестный раздел мероприятий")
				return
			}
		}
		if len(values["view"]) > 1 {
			writeError(w, http.StatusBadRequest, "invalid_history_view", "Неизвестный раздел мероприятий")
			return
		}
		view := events.HistoryView(values.Get("view"))
		if view == "" {
			view = events.HistoryUpcoming
		}
		items, err := eventService.History(r.Context(), userID, view)
		switch {
		case errors.Is(err, events.ErrInvalidHistoryView):
			writeError(w, http.StatusBadRequest, "invalid_history_view", "Неизвестный раздел мероприятий")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить ваши мероприятия")
		default:
			writeJSON(w, http.StatusOK, eventHistoryResponse{Events: items})
		}
	}
}

func writeEventMutationResult(w http.ResponseWriter, event events.Event, err error, deleted bool) {
	if writeContentPolicyError(w, err) {
		return
	}
	switch {
	case errors.Is(err, events.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Мероприятие не найдено")
	case errors.Is(err, events.ErrForbidden):
		writeError(w, http.StatusForbidden, "event_owner_required", "Действие доступно только организатору")
	case errors.Is(err, events.ErrUntrustedTicketURL):
		writeError(w, http.StatusBadRequest, "untrusted_ticket_url", "Ссылка на билеты должна вести на поддерживаемый билетный сервис")
	case errors.Is(err, events.ErrInvalidEvent):
		writeError(w, http.StatusBadRequest, "invalid_event", "Проверьте данные мероприятия")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось изменить мероприятие")
	case deleted:
		w.WriteHeader(http.StatusNoContent)
	default:
		writeJSON(w, http.StatusOK, event)
	}
}

func handleEvent(
	authService *maxauth.Service,
	eventService eventService,
	groupService groupService,
	socialService socialService,
	postService postService,
	attendanceService attendanceService,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/events/"), "/")
		parts := strings.Split(path, "/")
		if path == "" || len(parts) > 3 {
			handleNotFound(w, r)
			return
		}
		eventID, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || eventID <= 0 {
			handleNotFound(w, r)
			return
		}
		if len(parts) == 2 {
			switch parts[1] {
			case "groups":
				handleEventGroups(w, r, authService, groupService, eventID)
				return
			case "participants":
				handleEventParticipants(w, r, authService, eventService, eventID)
				return
			case "invitations":
				handleSendEventInvitation(w, r, authService, socialService, eventID)
				return
			case "posts":
				if postService != nil {
					handleEventPosts(w, r, authService, postService, eventID)
					return
				}
			case "attendance":
				if attendanceService != nil {
					handleAttendance(w, r, authService, attendanceService, eventID)
					return
				}
			}
			handleEventRelation(w, r, authService, eventService, eventID, parts[1])
			return
		}
		if len(parts) == 3 && parts[1] == "invitations" {
			handleResolveEventInvitation(w, r, authService, socialService, eventID, parts[2])
			return
		}
		if len(parts) == 3 && parts[1] == "attendance" && attendanceService != nil {
			if parts[2] == "reviews" {
				handleAttendanceReviews(w, r, authService, attendanceService, eventID)
				return
			}
			handleAttendanceReview(w, r, authService, attendanceService, eventID, parts[2])
			return
		}
		if len(parts) != 1 {
			handleNotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodPatch && r.Method != http.MethodDelete {
			w.Header().Set("Allow", http.MethodGet+", "+http.MethodPatch+", "+http.MethodDelete)
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Метод не поддерживается")
			return
		}
		if r.Method == http.MethodPatch || r.Method == http.MethodDelete {
			userID, ok := authenticatedUserID(w, r, authService)
			if !ok {
				return
			}
			if r.Method == http.MethodDelete {
				writeEventMutationResult(w, events.Event{}, eventService.Delete(r.Context(), userID, eventID), true)
				return
			}
			var input events.CreateInput
			if err := decodeJSON(w, r, &input); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_request", "Некорректные данные мероприятия")
				return
			}
			updated, err := eventService.Update(r.Context(), userID, eventID, input)
			writeEventMutationResult(w, updated, err, false)
			return
		}

		event, err := eventService.Get(r.Context(), eventID)
		switch {
		case errors.Is(err, events.ErrNotFound):
			writeError(w, http.StatusNotFound, "not_found", "Мероприятие не найдено")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить мероприятие")
		default:
			writeJSON(w, http.StatusOK, event)
		}
	}
}

func handleEventParticipants(
	w http.ResponseWriter,
	r *http.Request,
	authService *maxauth.Service,
	eventService eventService,
	eventID int64,
) {
	if !allowMethods(w, r, http.MethodGet) {
		return
	}
	userID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}
	items, err := eventService.Participants(r.Context(), userID, eventID)
	switch {
	case errors.Is(err, events.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Мероприятие не найдено")
	case errors.Is(err, events.ErrParticipationRequired):
		writeError(w, http.StatusForbidden, "event_participation_required", "Сначала отметьте «Хочу пойти»")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить участников мероприятия")
	default:
		writeJSON(w, http.StatusOK, participantListResponse{Participants: items})
	}
}

func handleEventRelation(
	w http.ResponseWriter,
	r *http.Request,
	authService *maxauth.Service,
	eventService eventService,
	eventID int64,
	relation string,
) {
	if relation != "participation" && relation != "saved" {
		handleNotFound(w, r)
		return
	}
	if r.Method != http.MethodPut && r.Method != http.MethodDelete {
		w.Header().Set("Allow", http.MethodPut+", "+http.MethodDelete)
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Метод не поддерживается")
		return
	}
	userID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}

	active := r.Method == http.MethodPut
	var err error
	if relation == "participation" {
		err = eventService.SetParticipation(r.Context(), userID, eventID, active)
	} else {
		err = eventService.SetSaved(r.Context(), userID, eventID, active)
	}
	switch {
	case errors.Is(err, events.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Мероприятие не найдено")
	case errors.Is(err, events.ErrEventEnded):
		writeError(w, http.StatusConflict, "event_ended", "Мероприятие уже завершилось")
	case errors.Is(err, events.ErrGroupMembership):
		writeError(w, http.StatusConflict, "group_membership_exists", "Сначала выйдите из группы мероприятия")
	case errors.Is(err, events.ErrForbidden):
		writeError(w, http.StatusForbidden, "event_owner_cannot_participate", "Организатор уже управляет этим мероприятием")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось изменить список мероприятий")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleEventActivity(authService *maxauth.Service, eventService eventService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		activity, err := eventService.Activity(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить ваши мероприятия")
			return
		}
		writeJSON(w, http.StatusOK, activity)
	}
}
