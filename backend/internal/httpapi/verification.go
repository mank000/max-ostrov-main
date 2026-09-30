package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/users"
	"kutezh/backend/internal/verification"
)

const maxVerificationImageBytes = 10 << 20

type faceVerificationResponse struct {
	Profile      users.Profile       `json:"profile"`
	Verification verification.Result `json:"verification"`
}

func handleFaceVerification(auth *maxauth.Service, userService userService, service *verification.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		contentType := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
		if contentType != "image/jpeg" && contentType != "image/png" {
			writeError(w, http.StatusBadRequest, "invalid_face_image", "Сделайте снимок в формате JPEG или PNG")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxVerificationImageBytes)
		image, err := io.ReadAll(r.Body)
		if err != nil || len(image) < 1024 {
			writeError(w, http.StatusBadRequest, "invalid_face_image", "Не удалось прочитать снимок")
			return
		}
		result, err := service.Verify(r.Context(), userID, image)
		switch {
		case errors.Is(err, verification.ErrNotAllowed):
			writeError(w, http.StatusNotFound, "not_found", "Функция недоступна")
		case errors.Is(err, verification.ErrBirthDateRequired):
			writeError(w, http.StatusConflict, "birth_date_required", "Сначала укажите дату рождения в профиле")
		case errors.Is(err, verification.ErrNoFace):
			writeError(w, http.StatusUnprocessableEntity, "face_not_found", "Лицо не найдено. Смотрите прямо в камеру")
		case errors.Is(err, verification.ErrMultipleFaces):
			writeError(w, http.StatusUnprocessableEntity, "multiple_faces", "В кадре должен быть только один человек")
		case errors.Is(err, verification.ErrAgeMismatch):
			writeError(w, http.StatusUnprocessableEntity, "age_mismatch", "Возраст по скану не совпал с возрастом в профиле")
		case errors.Is(err, verification.ErrInvalidImage):
			writeError(w, http.StatusUnprocessableEntity, "invalid_face_image", "Снимок не подошёл. Держите лицо ближе, ровно и при хорошем освещении.")
		case errors.Is(err, verification.ErrUnavailable):
			writeError(w, http.StatusServiceUnavailable, "face_ai_unavailable", "Проверка лица временно недоступна")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось завершить верификацию")
		default:
			profile, profileErr := userService.Get(r.Context(), userID)
			if profileErr != nil {
				writeProfileResult(w, profile, profileErr)
				return
			}
			writeJSON(w, http.StatusOK, faceVerificationResponse{Profile: profile, Verification: result})
		}
	}
}
