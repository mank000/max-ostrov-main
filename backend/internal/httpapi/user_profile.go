package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/users"
)

func handleProfileAvatar(authService *maxauth.Service, userService userService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		if r.Method == http.MethodDelete {
			profile, err := userService.SetAvatar(r.Context(), userID, nil)
			writeProfileResult(w, profile, err)
			return
		}
		var input profileAvatarRequest
		if decodeJSON(w, r, &input) != nil {
			writeError(w, http.StatusBadRequest, "invalid_avatar", "Выберите корректное изображение")
			return
		}
		if input.SourceMediaID > 0 || input.CropMediaID > 0 {
			if input.SourceMediaID <= 0 || input.CropMediaID <= 0 || input.MediaID != 0 {
				writeError(w, http.StatusBadRequest, "invalid_avatar", "Передайте исходную фотографию и выбранный кадр")
				return
			}
			profile, err := userService.SetAvatarCrop(r.Context(), userID, input.SourceMediaID, input.CropMediaID)
			writeProfileResult(w, profile, err)
			return
		}
		if input.MediaID <= 0 {
			writeError(w, http.StatusBadRequest, "invalid_avatar", "Выберите корректное изображение")
			return
		}
		mediaID := input.MediaID
		profile, err := userService.SetAvatar(r.Context(), userID, &mediaID)
		writeProfileResult(w, profile, err)
	}
}

func handleProfileAvatars(authService *maxauth.Service, userService userService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodPost, http.MethodPatch) {
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		if r.Method == http.MethodPost {
			var input profileAvatarAddRequest
			if decodeJSON(w, r, &input) != nil || input.MediaID <= 0 {
				writeError(w, http.StatusBadRequest, "invalid_avatar", "Выберите корректную фотографию")
				return
			}
			profile, err := userService.AddAvatar(r.Context(), userID, input.MediaID)
			writeProfileResult(w, profile, err)
			return
		}
		var input profileAvatarOrderRequest
		if decodeJSON(w, r, &input) != nil || len(input.MediaIDs) == 0 {
			writeError(w, http.StatusBadRequest, "invalid_avatar_order", "Не удалось изменить порядок фотографий")
			return
		}
		profile, err := userService.ReorderAvatars(r.Context(), userID, input.MediaIDs)
		writeProfileResult(w, profile, err)
	}
}

func handleProfileAvatarItem(authService *maxauth.Service, userService userService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodDelete) {
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		rawID := strings.TrimPrefix(r.URL.Path, "/api/v1/users/me/avatars/")
		if rawID == "" || strings.Contains(rawID, "/") {
			writeError(w, http.StatusBadRequest, "invalid_avatar", "Фотография профиля не найдена")
			return
		}
		mediaID, err := strconv.ParseInt(rawID, 10, 64)
		if err != nil || mediaID <= 0 {
			writeError(w, http.StatusBadRequest, "invalid_avatar", "Фотография профиля не найдена")
			return
		}
		profile, err := userService.RemoveAvatar(r.Context(), userID, mediaID)
		writeProfileResult(w, profile, err)
	}
}

func handleUserSearch(authService *maxauth.Service, userService userService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		values := r.URL.Query()
		if len(values) != 1 || len(values["q"]) != 1 {
			writeError(w, http.StatusBadRequest, "invalid_search", "Введите от 2 до 80 символов для поиска")
			return
		}
		profiles, err := userService.Search(r.Context(), userID, values.Get("q"))
		switch {
		case errors.Is(err, users.ErrInvalidSearch):
			writeError(w, http.StatusBadRequest, "invalid_search", "Введите от 2 до 80 символов для поиска")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось найти пользователей")
		default:
			writeJSON(w, http.StatusOK, userSearchResponse{Users: profiles})
		}
	}
}

func handleUserSuggestions(authService *maxauth.Service, userService userService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		if len(r.URL.Query()) != 0 {
			writeError(w, http.StatusBadRequest, "invalid_suggestions", "Неизвестные параметры рекомендаций")
			return
		}
		profiles, err := userService.Suggestions(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось загрузить рекомендации")
			return
		}
		writeJSON(w, http.StatusOK, userSuggestionsResponse{Users: profiles})
	}
}

func handleCurrentUser(authService *maxauth.Service, userService userService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPatch {
			w.Header().Set("Allow", http.MethodGet+", "+http.MethodPatch)
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Метод не поддерживается")
			return
		}

		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}

		switch r.Method {
		case http.MethodGet:
			profile, err := userService.Get(r.Context(), userID)
			writeProfileResult(w, profile, err)
		case http.MethodPatch:
			var update users.Update
			if err := decodeJSON(w, r, &update); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_request", "Некорректные данные профиля")
				return
			}
			profile, err := userService.Update(r.Context(), userID, update)
			writeProfileResult(w, profile, err)
		}
	}
}

func handlePresenceHeartbeat(authService *maxauth.Service, userService userService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodPost) {
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		switch err := userService.TouchPresence(r.Context(), userID); {
		case errors.Is(err, users.ErrNotFound):
			writeError(w, http.StatusNotFound, "not_found", "Профиль не найден")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось обновить статус в сети")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

func writeProfileResult(w http.ResponseWriter, profile users.Profile, err error) {
	if writeContentPolicyError(w, err) {
		return
	}
	var fieldError *users.InvalidProfileFieldError
	switch {
	case errors.As(err, &fieldError):
		writeError(w, http.StatusBadRequest, "invalid_profile", fieldError.Message)
	case errors.Is(err, users.ErrInvalidProfile):
		writeError(w, http.StatusBadRequest, "invalid_profile", "Проверьте данные профиля")
	case errors.Is(err, users.ErrInvalidAvatar):
		writeError(w, http.StatusBadRequest, "invalid_avatar", "Проверьте фотографию профиля и выбранное кадрирование")
	case errors.Is(err, users.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Профиль не найден")
	case errors.Is(err, users.ErrUsernameTaken):
		writeError(w, http.StatusConflict, "username_taken", "Это имя пользователя уже занято")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось обработать профиль")
	default:
		writeJSON(w, http.StatusOK, profile)
	}
}

type userSearchResponse struct {
	Users []users.PublicProfile `json:"users"`
}

type userSuggestionsResponse struct {
	Users []users.Suggestion `json:"users"`
}

type profileAvatarRequest struct {
	MediaID       int64 `json:"media_id,omitempty"`
	SourceMediaID int64 `json:"source_media_id,omitempty"`
	CropMediaID   int64 `json:"crop_media_id,omitempty"`
}

type profileAvatarAddRequest struct {
	MediaID int64 `json:"media_id"`
}

type profileAvatarOrderRequest struct {
	MediaIDs []int64 `json:"media_ids"`
}
