package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"kutezh/backend/internal/events"
	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/organizers"
)

func handleOrganizers(auth *maxauth.Service, service organizerService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodGet, http.MethodPost) {
			return
		}
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		if r.Method == http.MethodGet {
			items, err := service.ListOwned(r.Context(), userID)
			if writeOrganizerError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"organizers": items})
			return
		}
		var input organizers.Input
		if decodeJSON(w, r, &input) != nil {
			writeError(w, http.StatusBadRequest, "invalid_organizer", "Проверьте данные организатора")
			return
		}
		profile, err := service.Create(r.Context(), userID, input)
		if writeOrganizerError(w, err) {
			return
		}
		writeJSON(w, http.StatusCreated, profile)
	}
}
func handleOrganizer(auth *maxauth.Service, service organizerService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/organizers/"), "/")
		parts := strings.Split(path, "/")
		id, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || id <= 0 || len(parts) > 2 {
			handleNotFound(w, r)
			return
		}
		if len(parts) == 1 {
			if !allowMethods(w, r, http.MethodGet, http.MethodPut) {
				return
			}
		} else if parts[1] != "events" {
			handleNotFound(w, r)
			return
		} else if !allowMethods(w, r, http.MethodPost) {
			return
		}
		if len(parts) == 1 && r.Method == http.MethodGet {
			profile, err := service.Get(r.Context(), id)
			if writeOrganizerError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, profile)
			return
		}
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		if len(parts) == 1 && r.Method == http.MethodPut {
			var input organizers.Input
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_organizer", "Проверьте данные организатора")
				return
			}
			profile, err := service.Update(r.Context(), userID, id, input)
			if writeOrganizerError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, profile)
			return
		}
		if len(parts) == 2 && parts[1] == "events" && r.Method == http.MethodPost {
			var input events.CreateInput
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_event", "Проверьте данные мероприятия")
				return
			}
			event, err := service.CreateEvent(r.Context(), userID, id, input)
			if writeContentPolicyError(w, err) {
				return
			}
			if errors.Is(err, events.ErrUntrustedTicketURL) {
				writeError(w, http.StatusBadRequest, "untrusted_ticket_url", "Ссылка на билеты должна вести на поддерживаемый билетный сервис")
				return
			}
			if errors.Is(err, events.ErrInvalidEvent) {
				writeError(w, http.StatusBadRequest, "invalid_event", "Проверьте данные мероприятия")
				return
			}
			if writeOrganizerError(w, err) {
				return
			}
			writeJSON(w, http.StatusCreated, event)
			return
		}
		handleNotFound(w, r)
	}
}
func handleOrganizerReview(auth *maxauth.Service, service organizerService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodPut) {
			return
		}
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/admin/organizers/"), "/")
		parts := strings.Split(path, "/")
		if len(parts) != 2 || parts[1] != "status" {
			handleNotFound(w, r)
			return
		}
		id, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || id <= 0 {
			handleNotFound(w, r)
			return
		}
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		var input struct {
			Status organizers.Status `json:"status"`
		}
		if decodeJSON(w, r, &input) != nil {
			writeError(w, http.StatusBadRequest, "invalid_status", "Выберите статус проверки")
			return
		}
		profile, err := service.Review(r.Context(), userID, id, input.Status)
		if writeOrganizerError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, profile)
	}
}
func handleOrganizerReviewList(auth *maxauth.Service, service organizerService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		status := organizers.StatusPending
		if value := r.URL.Query().Get("status"); value != "" {
			status = organizers.Status(value)
		}
		for key, values := range r.URL.Query() {
			if key != "status" || len(values) != 1 {
				writeError(w, http.StatusBadRequest, "invalid_status", "Выберите статус проверки")
				return
			}
		}
		items, err := service.ListForReview(r.Context(), userID, status)
		if writeOrganizerError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"organizers": items})
	}
}
func writeOrganizerError(w http.ResponseWriter, err error) bool {
	if writeContentPolicyError(w, err) {
		return true
	}
	switch {
	case err == nil:
		return false
	case errors.Is(err, organizers.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "invalid_organizer", "Проверьте данные организатора")
	case errors.Is(err, organizers.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Организатор не найден")
	case errors.Is(err, organizers.ErrForbidden):
		writeError(w, http.StatusForbidden, "moderator_required", "Требуется роль модератора")
	case errors.Is(err, organizers.ErrNotVerified):
		writeError(w, http.StatusForbidden, "organizer_not_verified", "Сначала дождитесь подтверждения организатора")
	case errors.Is(err, organizers.ErrAlreadyExists):
		writeError(w, http.StatusConflict, "organizer_exists", "Профиль организатора с таким названием уже существует")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось обработать данные организатора")
	}
	return true
}
