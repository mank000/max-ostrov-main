package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"kutezh/backend/internal/attendance"
	"kutezh/backend/internal/maxauth"
)

func handleAttendance(w http.ResponseWriter, r *http.Request, authService *maxauth.Service, service attendanceService, eventID int64) {
	if !allowMethods(w, r, http.MethodGet, http.MethodPut) {
		return
	}
	userID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		confirmation, err := service.Get(r.Context(), userID, eventID)
		if writeAttendanceError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, confirmation)
		return
	}
	var input attendance.EvidenceInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_attendance_evidence", "Добавьте геопроверку или фото мероприятия")
		return
	}
	confirmation, err := service.Submit(r.Context(), userID, eventID, input)
	if writeAttendanceError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, confirmation)
}

func handleAttendanceReview(w http.ResponseWriter, r *http.Request, authService *maxauth.Service, service attendanceService, eventID int64, userValue string) {
	if !allowMethods(w, r, http.MethodPut) {
		return
	}
	targetID, err := strconv.ParseInt(userValue, 10, 64)
	if err != nil || targetID <= 0 {
		handleNotFound(w, r)
		return
	}
	reviewerID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}
	var input attendance.ReviewInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_attendance_status", "Выберите подтверждение или отклонение")
		return
	}
	confirmation, err := service.Review(r.Context(), reviewerID, eventID, targetID, input)
	if writeAttendanceError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, confirmation)
}

func handleAttendanceReviews(w http.ResponseWriter, r *http.Request, authService *maxauth.Service, service attendanceService, eventID int64) {
	if !allowMethods(w, r, http.MethodGet) {
		return
	}
	organizerID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}
	confirmations, err := service.ListForOrganizer(r.Context(), organizerID, eventID)
	if writeAttendanceError(w, err) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"confirmations": confirmations})
}

func writeAttendanceError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, attendance.ErrInvalidEvidence):
		writeError(w, http.StatusBadRequest, "invalid_attendance_evidence", "Проверьте данные подтверждения посещения")
	case errors.Is(err, attendance.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Подтверждение посещения не найдено")
	case errors.Is(err, attendance.ErrParticipationRequired):
		writeError(w, http.StatusForbidden, "event_participation_required", "Сначала отметьте «Хочу пойти»")
	case errors.Is(err, attendance.ErrOutsideWindow):
		writeError(w, http.StatusConflict, "attendance_window_closed", "Сейчас нельзя подтвердить посещение этого мероприятия")
	case errors.Is(err, attendance.ErrInvalidMedia):
		writeError(w, http.StatusBadRequest, "invalid_media", "Фото недоступно или уже используется")
	case errors.Is(err, attendance.ErrOrganizerRequired):
		writeError(w, http.StatusForbidden, "organizer_required", "Проверять посещение может только организатор")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось обработать подтверждение посещения")
	}
	return true
}
