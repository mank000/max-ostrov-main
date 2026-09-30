package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/moderation"
)

const moderationCookieName = "kutezh_moderation_session"
const moderationCookieTTL = 10 * 365 * 24 * time.Hour

func handleCreateReport(auth *maxauth.Service, service *moderation.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		var input moderation.ReportInput
		if decodeJSON(w, r, &input) != nil {
			writeError(w, http.StatusBadRequest, "invalid_report", "Проверьте данные жалобы")
			return
		}
		report, err := service.CreateReport(r.Context(), userID, input)
		if writeModerationError(w, err) {
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"id":     report.ID,
			"status": report.Status,
		})
	}
}

func handleModeration(service *moderation.Service, mediaService mediaService, config HandlerConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !moderationHostAllowed(r, config) {
			handleNotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if !sameOriginMutation(r, config.SecureCookies) ||
				(r.Header.Get("Origin") == "" && !strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "same-origin")) ||
				(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")) != "" && !strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "same-origin")) {
				writeError(w, http.StatusForbidden, "cross_origin_request", "Запрос с другого сайта отклонён")
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Frame-Options", "DENY")
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/moderation/")
		switch path {
		case "auth/challenge":
			if !allowMethods(w, r, http.MethodPost) {
				return
			}
			var input struct {
				MAXUserID int64 `json:"max_user_id"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_request", "Укажите MAX ID")
				return
			}
			id, err := service.Challenge(r.Context(), input.MAXUserID)
			if writeModerationError(w, err) {
				return
			}
			writeJSON(w, http.StatusAccepted, map[string]any{
				"challenge_id":       id,
				"expires_in_seconds": 300,
			})
			return
		case "auth/verify":
			if !allowMethods(w, r, http.MethodPost) {
				return
			}
			var input struct {
				ChallengeID string `json:"challenge_id"`
				Code        string `json:"code"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_request", "Проверьте код")
				return
			}
			token, principal, err := service.Verify(r.Context(), input.ChallengeID, input.Code)
			if writeModerationError(w, err) {
				return
			}
			setModerationCookie(w, token, config.SecureCookies)
			writeJSON(w, http.StatusOK, principal)
			return
		case "auth/logout":
			if !allowMethods(w, r, http.MethodPost) {
				return
			}
			if cookie, err := r.Cookie(moderationCookieName); err == nil {
				if err := service.Logout(r.Context(), cookie.Value); err != nil {
					writeModerationError(w, err)
					return
				}
			}
			setModerationCookie(w, "", config.SecureCookies)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		principal, ok := authenticatedModerator(w, r, service, config.SecureCookies)
		if !ok {
			return
		}
		if path == "support" || strings.HasPrefix(path, "support/") {
			handleModerationSupport(w, r, service, mediaService, principal, path)
			return
		}
		if path != "audit" && handleAdminManagement(w, r, service, principal, path) {
			return
		}
		switch path {
		case "auth/session":
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			writeJSON(w, http.StatusOK, principal)
		case "reports":
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			beforeID, limit, ok := moderationPage(w, r, "status", "target_type")
			if !ok {
				return
			}
			status := r.URL.Query().Get("status")
			if status == "" {
				status = "open"
			}
			reports, cursor, err := service.ListReports(r.Context(), status, moderation.TargetType(r.URL.Query().Get("target_type")), beforeID, limit)
			if writeModerationError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"reports":     reports,
				"next_cursor": cursor,
			})
		case "audit":
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			beforeID, limit, ok := moderationPage(w, r)
			if !ok {
				return
			}
			actions, cursor, err := service.ListActions(r.Context(), beforeID, limit)
			if writeModerationError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"actions":     actions,
				"next_cursor": cursor,
			})
		case "roles":
			if !allowMethods(w, r, http.MethodGet, http.MethodPost) {
				return
			}
			if principal.Role != "administrator" {
				writeError(w, http.StatusForbidden, "administrator_required", "Требуется роль администратора")
				return
			}
			if r.Method == http.MethodGet {
				members, err := service.ListRoles(r.Context())
				if writeModerationError(w, err) {
					return
				}
				writeJSON(w, http.StatusOK, map[string]any{"members": members})
				return
			}
			var input struct {
				MAXUserID int64  `json:"max_user_id"`
				Role      string `json:"role"`
				Operation string `json:"operation"`
				Reason    string `json:"reason"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_role_change", "Проверьте данные роли")
				return
			}
			userID, err := service.ChangeRole(r.Context(), principal.UserID, input.MAXUserID, input.Role, input.Operation, input.Reason)
			if writeModerationError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"user_id": userID})
		default:
			if !strings.HasPrefix(path, "reports/") {
				handleNotFound(w, r)
				return
			}
			handleModerationReportItem(w, r, service, principal, strings.TrimPrefix(path, "reports/"))
		}
	}
}

func handleModerationReportItem(w http.ResponseWriter, r *http.Request, service *moderation.Service, principal moderation.Principal, path string) {
	parts := strings.Split(path, "/")
	if len(parts) < 1 || len(parts) > 3 {
		handleNotFound(w, r)
		return
	}
	reportID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || reportID <= 0 {
		handleNotFound(w, r)
		return
	}
	if len(parts) == 1 {
		if !allowMethods(w, r, http.MethodGet) {
			return
		}
		report, err := service.GetReport(r.Context(), reportID)
		if writeModerationError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, report)
		return
	}
	if len(parts) == 2 && parts[1] == "decision" {
		if !allowMethods(w, r, http.MethodPost) {
			return
		}
		var input moderation.DecisionInput
		if decodeJSON(w, r, &input) != nil {
			writeError(w, http.StatusBadRequest, "invalid_decision", "Проверьте решение")
			return
		}
		report, err := service.Decide(r.Context(), principal.UserID, reportID, input)
		if writeModerationError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, report)
		return
	}
	if len(parts) == 3 && parts[1] == "media" {
		if !allowMethods(w, r, http.MethodGet) {
			return
		}
		mediaID, err := strconv.ParseInt(parts[2], 10, 64)
		if err != nil || mediaID <= 0 {
			handleNotFound(w, r)
			return
		}
		media, err := service.OpenReportMedia(r.Context(), reportID, mediaID)
		if writeModerationError(w, err) {
			return
		}
		defer func() {
			_ = media.File.Close()
		}()
		w.Header().Set("Content-Type", media.MIMEType)
		w.Header().Set("Content-Disposition", "inline")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, "evidence", time.Time{}, media.File)
		return
	}
	handleNotFound(w, r)
}

func moderationPage(w http.ResponseWriter, r *http.Request, additionalKeys ...string) (int64, int, bool) {
	allowed := map[string]bool{
		"before_id": true,
		"limit":     true,
	}
	for _, key := range additionalKeys {
		allowed[key] = true
	}
	for key, values := range r.URL.Query() {
		if !allowed[key] || len(values) != 1 {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Проверьте параметры списка")
			return 0, 0, false
		}
	}
	var beforeID int64
	var err error
	if value := r.URL.Query().Get("before_id"); value != "" {
		beforeID, err = strconv.ParseInt(value, 10, 64)
		if err != nil || beforeID < 0 {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Проверьте параметры списка")
			return 0, 0, false
		}
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		limit, err = strconv.Atoi(value)
		if err != nil || limit < 1 || limit > 100 {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Проверьте параметры списка")
			return 0, 0, false
		}
	}
	return beforeID, limit, true
}

func authenticatedModerator(w http.ResponseWriter, r *http.Request, service *moderation.Service, secure bool) (moderation.Principal, bool) {
	cookie, err := r.Cookie(moderationCookieName)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "moderation_login_required", "Войдите в кабинет модерации")
		return moderation.Principal{}, false
	}
	principal, err := service.Session(r.Context(), cookie.Value)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "moderation_login_required", "Войдите в кабинет модерации")
		return moderation.Principal{}, false
	}
	setModerationCookie(w, cookie.Value, secure)
	return principal, true
}

func setModerationCookie(w http.ResponseWriter, token string, secure bool) {
	maxAge := int(moderationCookieTTL / time.Second)
	expires := time.Now().Add(moderationCookieTTL)
	if token == "" {
		maxAge = -1
		expires = time.Unix(1, 0)
	}
	http.SetCookie(w, &http.Cookie{
		Name: moderationCookieName, Value: token, Path: "/", MaxAge: maxAge, Expires: expires,
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode,
	})
}

func writeModerationError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, moderation.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_moderation_request", "Проверьте данные")
	case errors.Is(err, moderation.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Объект не найден")
	case errors.Is(err, moderation.ErrForbidden):
		writeError(w, http.StatusForbidden, "moderator_required", "Недостаточно прав")
	case errors.Is(err, moderation.ErrConflict):
		writeError(w, http.StatusConflict, "moderation_conflict", "Данные изменились. Обновите страницу")
	case errors.Is(err, moderation.ErrAuth):
		writeError(w, http.StatusUnauthorized, "invalid_moderation_code", "Код недействителен или истёк")
	case errors.Is(err, moderation.ErrRateLimited):
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Слишком много жалоб. Попробуйте позже")
	case errors.Is(err, moderation.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "moderation_unavailable", "Вход временно недоступен")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось выполнить действие")
	}
	return true
}
