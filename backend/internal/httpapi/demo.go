//go:build demo

package httpapi

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/moderation"
	"net/http"
	"time"
)

// В обычный бинарник этот файл не входит. ID берём только из наших фикстур,
// произвольный user_id здесь не превращается в сессию.
func RegisterDemoRoutes(mux *http.ServeMux, db *sql.DB, auth *maxauth.Service) {
	mux.HandleFunc("GET /api/v1/demo/accounts", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, []map[string]any{
			{"id": 1001, "name": "Алексей", "role": "Администратор"},
			{"id": 1002, "name": "Мира", "role": "Пользователь"},
			{"id": 1003, "name": "Никита", "role": "Пользователь"},
		})
	})
	mux.HandleFunc("POST /api/v1/demo/session", func(w http.ResponseWriter, r *http.Request) {
		if !moderationHostAllowed(r, HandlerConfig{}) {
			handleNotFound(w, r)
			return
		}
		var input struct {
			UserID int64 `json:"user_id"`
		}
		if decodeJSON(w, r, &input) != nil || input.UserID < 1001 || input.UserID > 1003 {
			writeError(w, http.StatusBadRequest, "invalid_demo_user", "Выберите один из тестовых профилей")
			return
		}
		var user maxauth.User
		err := db.QueryRowContext(r.Context(), `SELECT u.id, u.first_name, i.provider_user_id
   FROM users u JOIN user_identities i ON i.user_id = u.id AND i.provider = 'max'
   WHERE u.id = $1 AND u.moderation_suspended_at IS NULL`, input.UserID).
			Scan(&user.ID, &user.FirstName, &user.ProviderUserID)
		if err != nil {
			writeError(w, 403, "demo_user_unavailable", "Тестовый профиль недоступен")
			return
		}
		token, session, err := auth.CreateSession(user)
		if err != nil {
			writeSessionError(w, err)
			return
		}
		if previous := requestSessionToken(r); previous != "" {
			if err := auth.Logout(previous); err != nil {
				_ = auth.Logout(token)
				writeSessionError(w, err)
				return
			}
		}
		setSessionCookie(w, token, session.ExpiresAt, false)
		writeAuthSession(w, r, auth, token, session)
	})
	mux.HandleFunc("POST /api/v1/demo/moderation-session", func(w http.ResponseWriter, r *http.Request) {
		if !moderationHostAllowed(r, HandlerConfig{}) {
			handleNotFound(w, r)
			return
		}
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			writeError(w, 500, "demo_login_failed", "Не удалось войти")
			return
		}
		token := base64.RawURLEncoding.EncodeToString(raw)
		hash := sha256.Sum256([]byte(token))
		_, err := db.ExecContext(r.Context(), `INSERT INTO moderation_sessions
   (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES ($1, 1001, now(), now(), $2)`, hash[:], time.Now().Add(24*time.Hour))
		if err != nil {
			writeError(w, 503, "demo_login_failed", "Не удалось создать сессию")
			return
		}
		setModerationCookie(w, token, false)
		writeJSON(w, 200, moderation.Principal{UserID: 1001, Role: "administrator"})
	})
}
