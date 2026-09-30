package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/notifications"
)

func handleNotifications(authService *maxauth.Service, service notificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodGet, http.MethodPut) {
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		if r.Method == http.MethodPut {
			if err := service.MarkAllRead(r.Context(), userID); err != nil {
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось отметить уведомления")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		values := r.URL.Query()
		for key := range values {
			if (key != "unread_only" && key != "before_id") || len(values[key]) != 1 {
				writeError(w, http.StatusBadRequest, "invalid_notification_filter", "Проверьте фильтр уведомлений")
				return
			}
		}
		unreadOnly := false
		if value := values.Get("unread_only"); value != "" {
			parsed, err := strconv.ParseBool(value)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid_notification_filter", "Проверьте фильтр уведомлений")
				return
			}
			unreadOnly = parsed
		}
		var beforeID int64
		if value := values.Get("before_id"); value != "" {
			var err error
			beforeID, err = strconv.ParseInt(value, 10, 64)
			if err != nil || beforeID <= 0 {
				writeError(w, http.StatusBadRequest, "invalid_notification_filter", "Проверьте страницу уведомлений")
				return
			}
		}
		page, err := service.List(r.Context(), userID, unreadOnly, beforeID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить уведомления")
			return
		}
		writeJSON(w, http.StatusOK, page)
	}
}

func handleNotification(authService *maxauth.Service, service notificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodPut) {
			return
		}
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/users/me/notifications/"), "/")
		if path == "dating-matches/read" {
			userID, ok := authenticatedUserID(w, r, authService)
			if !ok {
				return
			}
			if err := service.MarkMatchesRead(r.Context(), userID); err != nil {
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось отметить симпатии")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		parts := strings.Split(path, "/")
		if len(parts) != 2 || parts[1] != "read" {
			handleNotFound(w, r)
			return
		}
		notificationID, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || notificationID <= 0 {
			handleNotFound(w, r)
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		err = service.MarkRead(r.Context(), userID, notificationID)
		if errors.Is(err, notifications.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Уведомление не найдено")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось отметить уведомление")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleNotificationCounts(auth *maxauth.Service, service notificationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		counts, err := service.Counts(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось получить число уведомлений")
			return
		}
		writeJSON(w, http.StatusOK, counts)
	}
}
