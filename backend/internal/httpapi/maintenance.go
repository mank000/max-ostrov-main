package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"kutezh/backend/internal/maxauth"
)

func maintenanceAccess(w http.ResponseWriter, config HandlerConfig, userID int64) bool {
	if len(config.MaintenanceAllowedIDs) == 0 || config.MaintenanceAllowedIDs[userID] {
		return true
	}
	writeError(w, http.StatusServiceUnavailable, "maintenance", "Дорабатываем приложение\nСкоро вернемся")
	return false
}

// Gate public routes too; identity comes only from server-validated sessions/tickets.
func withMaintenance(auth *maxauth.Service, config HandlerConfig, next http.Handler) http.Handler {
	if len(config.MaintenanceAllowedIDs) == 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/health", "/api/v1/app-info", "/api/v1/auth/max", "/api/v1/auth/logout":
			next.ServeHTTP(w, r)
			return
		}
		// The separate moderation console retains its own OTP authorization.
		if strings.HasPrefix(r.URL.Path, "/api/v1/moderation/") {
			next.ServeHTTP(w, r)
			return
		}
		var userID int64
		var session maxauth.Session
		var err error
		path := r.URL.Path
		if strings.HasPrefix(path, "/api/v1/media/") && strings.HasSuffix(path, "/download") && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			id, _ := strconv.ParseInt(strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/media/"), "/download"), 10, 64)
			userID, err = auth.DownloadUser(r.URL.Query().Get("token"), id)
		} else {
			switch {
			case path == "/api/v1/realtime":
				session, err = readResourceSession(r, auth, maxauth.RealtimeRead)
			case strings.HasPrefix(path, "/api/v1/media/") && strings.HasSuffix(path, "/content"):
				session, err = readResourceSession(r, auth, maxauth.MediaRead)
			default:
				session, err = auth.Session(requestSessionToken(r))
			}
			userID = session.User.ID
		}
		if err != nil {
			userID = 0
		}
		if !maintenanceAccess(w, config, userID) {
			return
		}
		next.ServeHTTP(w, r)
	})
}
