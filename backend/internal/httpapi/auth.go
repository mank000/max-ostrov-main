package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/users"
)

func handleMAXAuth(logger *slog.Logger, authService *maxauth.Service, userService userService, config HandlerConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request authRequest
		if err := decodeJSON(w, r, &request); err != nil || request.InitData == "" {
			writeError(w, http.StatusBadRequest, "invalid_request", "Некорректные данные запроса")
			return
		}

		if token := requestSessionToken(r); token != "" {
			session, err := authService.ResumeMAX(request.InitData, token)
			if err == nil {
				if !maintenanceAccess(w, config, session.User.ID) {
					return
				}
				setSessionCookie(w, token, session.ExpiresAt, config.SecureCookies)
				writeAuthSession(w, r, authService, token, session)
				return
			}
			if !errors.Is(err, maxauth.ErrInvalidSession) &&
				!errors.Is(err, maxauth.ErrInvalidInitData) &&
				!errors.Is(err, maxauth.ErrExpiredInitData) &&
				!errors.Is(err, maxauth.ErrUnavailable) {
				writeSessionError(w, err)
				return
			}
		}

		externalUser, err := authService.ValidateMAX(request.InitData)
		switch {
		case errors.Is(err, maxauth.ErrUnavailable):
			writeError(w, http.StatusServiceUnavailable, "auth_unavailable", "Вход через MAX временно недоступен")
			return
		case errors.Is(err, maxauth.ErrExpiredInitData):
			writeError(w, http.StatusUnauthorized, "expired_max_data", "Данные запуска устарели. Закройте приложение и откройте его снова через MAX")
			return
		case errors.Is(err, maxauth.ErrInvalidInitData):
			writeError(w, http.StatusUnauthorized, "invalid_max_data", "Не удалось подтвердить данные MAX")
			return
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось создать сессию")
			return
		}
		profile, err := userService.UpsertFromProvider(r.Context(), users.ProviderMAX, externalUser)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось сохранить профиль")
			return
		}
		if !maintenanceAccess(w, config, profile.ID) {
			return
		}
		externalUser.ID = profile.ID
		token, session, err := authService.CreateSession(externalUser)
		if errors.Is(err, maxauth.ErrSuspended) {
			writeError(w, http.StatusForbidden, "account_suspended", "Доступ к аккаунту ограничен. Обратитесь в поддержку")
			return
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось создать сессию")
			return
		}

		if previous := requestSessionToken(r); previous != "" && previous != token {
			if !revokeSession(logger, r, authService, previous, "session_replaced") {
				revokeSession(logger, r, authService, token, "failed_session_replacement")
				writeError(w, http.StatusServiceUnavailable, "auth_unavailable", "Не удалось заменить сессию. Повторите попытку")
				return
			}
		}
		setSessionCookie(w, token, session.ExpiresAt, config.SecureCookies)
		writeAuthSession(w, r, authService, token, session)
	}
}

func handleSession(authService *maxauth.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := requestSessionToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "Требуется вход")
			return
		}

		session, err := authService.Session(token)
		if err != nil {
			writeSessionError(w, err)
			return
		}

		writeAuthSession(w, r, authService, token, session)
	}
}

func handleLogout(logger *slog.Logger, authService *maxauth.Service, config HandlerConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if token := requestSessionToken(r); token != "" {
			if err := authService.Logout(token); err != nil {
				logger.Error("session revocation failed", "request_id", requestIDFromContext(r.Context()), "reason", "logout", "error", err)
				writeError(w, http.StatusServiceUnavailable, "auth_unavailable", "Не удалось завершить сессию. Повторите попытку")
				return
			}
		}
		setSessionCookie(w, "", time.Unix(1, 0), config.SecureCookies)
		w.WriteHeader(http.StatusNoContent)
	}
}

func revokeSession(logger *slog.Logger, r *http.Request, authService *maxauth.Service, token, reason string) bool {
	if err := authService.Logout(token); err != nil {
		logger.Error("session revocation failed",
			"request_id", requestIDFromContext(r.Context()),
			"reason", reason,
			"error", err,
		)
		return false
	}
	return true
}

func setSessionCookie(w http.ResponseWriter, value string, expiresAt time.Time, secure bool) {
	maxAge := int(time.Until(expiresAt).Seconds())
	if value == "" {
		maxAge = -1
	} else if maxAge < 1 {
		maxAge = 1
	}

	sameSite := http.SameSiteLaxMode
	if secure {
		sameSite = http.SameSiteNoneMode
		http.SetCookie(w, &http.Cookie{
			Name: sessionCookieName, Path: "/", Value: "", MaxAge: -1,
			Expires: time.Unix(1, 0), HttpOnly: true, Secure: true, SameSite: sameSite,
		})
	}
	http.SetCookie(w, &http.Cookie{
		Name:        sessionCookieName,
		Value:       value,
		Path:        "/",
		Expires:     expiresAt,
		MaxAge:      maxAge,
		HttpOnly:    true,
		Secure:      secure,
		SameSite:    sameSite,
		Partitioned: secure,
	})
}

func authenticatedUserID(w http.ResponseWriter, r *http.Request, authService *maxauth.Service) (int64, bool) {
	token := requestSessionToken(r)
	if token == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Требуется вход")
		return 0, false
	}
	session, err := authService.Session(token)
	if err != nil {
		writeSessionError(w, err)
		return 0, false
	}
	return session.User.ID, true
}

func writeSessionError(w http.ResponseWriter, err error) {
	if errors.Is(err, maxauth.ErrInvalidSession) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Сессия недействительна или истекла")
		return
	}
	writeError(w, http.StatusServiceUnavailable, "auth_unavailable", "Проверка сессии временно недоступна")
}

type authRequest struct {
	InitData string `json:"init_data"`
}

// An explicit Authorization header takes precedence, including when malformed.
// Never fall back to a cookie belonging to a different user in that case.
func requestSessionToken(r *http.Request) string {
	if values, present := r.Header["Authorization"]; present {
		if len(values) != 1 {
			return ""
		}
		parts := strings.Fields(values[0])
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return ""
		}
		return parts[1]
	}
	if cookie, err := r.Cookie(sessionCookieName); err == nil {
		return cookie.Value
	}
	return ""
}

func writeAuthSession(w http.ResponseWriter, r *http.Request, authService *maxauth.Service, token string, session maxauth.Session) {
	if r.Header.Get("X-Kutezh-Session-Transport") != "bearer" {
		writeJSON(w, http.StatusOK, session)
		return
	}
	mediaToken, err := authService.CreateResourceToken(token, maxauth.MediaRead)
	if err != nil {
		writeSessionError(w, err)
		return
	}
	realtimeToken, err := authService.CreateResourceToken(token, maxauth.RealtimeRead)
	if err != nil {
		writeSessionError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		maxauth.Session
		AccessToken   string `json:"access_token"`
		MediaToken    string `json:"media_token"`
		RealtimeToken string `json:"realtime_token"`
	}{session, token, mediaToken, realtimeToken})
}

// Only the media content and realtime handlers may accept a scoped URL ticket.
func readResourceSession(r *http.Request, authService *maxauth.Service, scope maxauth.ResourceScope) (maxauth.Session, error) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return maxauth.Session{}, maxauth.ErrInvalidSession
	}
	if tickets, present := values["resource_token"]; present {
		if len(tickets) != 1 || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
			return maxauth.Session{}, maxauth.ErrInvalidSession
		}
		return authService.ResourceSession(tickets[0], scope)
	}
	return authService.Session(requestSessionToken(r))
}
