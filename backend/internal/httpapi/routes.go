package httpapi

import (
	"context"
	dating "kutezh/dating"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"kutezh/backend/internal/maxauth"
)

const sessionCookieName = "kutezh_session"

type healthResponse struct {
	Status string `json:"status"`
}

type HandlerConfig struct {
	ModerationURL         string
	ExtraRoutes           func(*http.ServeMux)
	LocalDemo             bool
	MaintenanceAllowedIDs map[int64]bool
	SecureCookies         bool
	GeocodingURL          string
	GeocodingAutocomplete bool
	MediaXAccel           bool
	ReadinessCheck        func(context.Context) error
	Shutdown              <-chan struct{}
	ModerationHost        string
}

func NewHandler(
	logger *slog.Logger,
	authService *maxauth.Service,
	userService userService,
	eventService eventService,
	groupService groupService,
	socialService socialService,
	config HandlerConfig,
	featureServices FeatureServices,
) http.Handler {
	mux := http.NewServeMux()
	if config.ExtraRoutes != nil {
		config.ExtraRoutes(mux)
	}
	if featureServices.Dating != nil {
		datingAPI := dating.NewHandler(logger, featureServices.Dating, func(w http.ResponseWriter, r *http.Request) (int64, bool) {
			id, ok := authenticatedUserID(w, r, authService)
			if !ok {
				return 0, false
			}
			profile, err := userService.Get(r.Context(), id)
			if err != nil {
				writeError(w, 503, "profile_unavailable", "Не удалось загрузить профиль")
				return 0, false
			}
			if profile.OnboardingVersion < 1 {
				writeError(w, 403, "registration_required", "Сначала завершите регистрацию")
				return 0, false
			}
			return id, true
		})
		mux.Handle("/api/v1/dating/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			clone := r.Clone(r.Context())
			urlCopy := *r.URL
			urlCopy.Path = "/api/" + strings.TrimPrefix(r.URL.Path, "/api/v1/dating/")
			clone.URL = &urlCopy
			datingAPI.ServeHTTP(w, clone)
		}))
	}
	if featureServices.Games != nil {
		mux.HandleFunc("POST /api/v1/games/start", handleGames(authService, featureServices.Games))
		mux.HandleFunc("POST /api/v1/games/answer", handleGames(authService, featureServices.Games))
		mux.HandleFunc("POST /api/v1/games/flappy/start", handleFlappyGames(authService, featureServices.Games))
		mux.HandleFunc("POST /api/v1/games/flappy/coin", handleFlappyGames(authService, featureServices.Games))
		mux.HandleFunc("GET /api/v1/games/life", handleLifeGame(authService, featureServices.Games))
		mux.HandleFunc("POST /api/v1/games/life/action", handleLifeGame(authService, featureServices.Games))
		mux.HandleFunc("POST /api/v1/games/dino/start", handleDinoGames(authService, featureServices.Games))
		mux.HandleFunc("POST /api/v1/games/dino/coin", handleDinoGames(authService, featureServices.Games))
		mux.HandleFunc("POST /api/v1/games/dino/boss", handleDinoGames(authService, featureServices.Games))
		mux.HandleFunc("GET /api/v1/games/leaderboard", handleGameLeaderboard(authService, featureServices.Games))
		mux.HandleFunc("POST /api/v1/games/score", handleGameLeaderboard(authService, featureServices.Games))
	}
	if featureServices.Clips != nil {
		mux.HandleFunc("/api/v1/clips", handleClips(authService, featureServices.Clips))
		mux.HandleFunc("/api/v1/clips/", handleClips(authService, featureServices.Clips))
	}
	geocoding := newCitySearch(config.GeocodingURL)
	mux.HandleFunc("GET /api/v1/geocoding/config", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]bool{"autocomplete": config.GeocodingAutocomplete})
	})
	mux.HandleFunc("/api/v1/cities", requireMethod(http.MethodGet, geocoding.ServeHTTP))
	mux.HandleFunc("/api/v1/places/search", requireMethod(http.MethodGet, geocoding.ServePlaceSearchHTTP))
	mux.HandleFunc("/api/v1/locations/reverse", requireMethod(http.MethodGet, geocoding.ServeReverseHTTP))
	mux.HandleFunc("/api/v1/health", requireMethod(http.MethodGet, handleHealth(config.ReadinessCheck)))
	mux.HandleFunc("/api/v1/app-info", requireMethod(http.MethodGet, handleAppInfo(authService, config)))
	mux.HandleFunc("/api/v1/auth/max", requireMethod(http.MethodPost, handleMAXAuth(logger, authService, userService, config)))
	mux.HandleFunc("/api/v1/auth/session", requireMethod(http.MethodGet, handleSession(authService)))
	mux.HandleFunc("/api/v1/auth/logout", requireMethod(http.MethodPost, handleLogout(logger, authService, config)))
	mux.HandleFunc("/api/v1/users/me", handleCurrentUser(authService, userService))
	mux.HandleFunc("/api/v1/users/me/presence", handlePresenceHeartbeat(authService, userService))
	mux.HandleFunc("/api/v1/avatar-likes/", handleAvatarLikes(authService, userService))
	mux.HandleFunc("/api/v1/users/me/avatar", handleProfileAvatar(authService, userService))
	mux.HandleFunc("/api/v1/users/me/avatars", handleProfileAvatars(authService, userService))
	mux.HandleFunc("/api/v1/users/me/avatars/", handleProfileAvatarItem(authService, userService))
	if featureServices.Verification != nil {
		mux.HandleFunc("/api/v1/users/me/face-verification", requireMethod(http.MethodPost, handleFaceVerification(authService, userService, featureServices.Verification)))
	}
	mux.HandleFunc("/api/v1/users/search", requireMethod(http.MethodGet, handleUserSearch(authService, userService)))
	mux.HandleFunc("/api/v1/users/me/suggestions", requireMethod(http.MethodGet, handleUserSuggestions(authService, userService)))
	mux.HandleFunc("/api/v1/users/me/friends", requireMethod(http.MethodGet, handleFriends(authService, socialService)))
	mux.HandleFunc("/api/v1/users/me/friend-requests", requireMethod(http.MethodGet, handleFriendRequests(authService, socialService)))
	mux.HandleFunc("/api/v1/users/me/blocks", requireMethod(http.MethodGet, handleBlocks(authService, socialService)))
	mux.HandleFunc("/api/v1/users/me/event-invitations", requireMethod(http.MethodGet, handleEventInvitations(authService, socialService)))
	mux.HandleFunc("/api/v1/users/me/group-invitations", handleGroupInvitations(authService, groupService))
	mux.HandleFunc("/api/v1/users/me/events", handleUserEvents(authService, eventService))
	mux.HandleFunc("GET /api/v1/users/me/event-activity", handleEventActivity(authService, eventService))
	if featureServices.Notifications != nil {
		mux.HandleFunc("/api/v1/users/me/notifications/counts", requireMethod(http.MethodGet, handleNotificationCounts(authService, featureServices.Notifications)))
		mux.HandleFunc("/api/v1/users/me/notifications", handleNotifications(authService, featureServices.Notifications))
		mux.HandleFunc("/api/v1/users/me/notifications/", handleNotification(authService, featureServices.Notifications))
	}
	if featureServices.Rewards != nil {
		mux.HandleFunc("/api/v1/users/me/wallet", requireMethod(http.MethodGet, handleWallet(authService, featureServices.Rewards)))
		mux.HandleFunc("/api/v1/users/me/coin-transactions", requireMethod(http.MethodGet, handleTransactions(authService, featureServices.Rewards)))
		mux.HandleFunc("/api/v1/users/me/achievements", requireMethod(http.MethodGet, handleAchievements(authService, featureServices.Rewards)))
		mux.HandleFunc("/api/v1/users/me/gifts", requireMethod(http.MethodGet, handleGifts(authService, featureServices.Rewards)))
		mux.HandleFunc("/api/v1/users/me/profile-decoration", handleDecoration(authService, featureServices.Rewards))
		mux.HandleFunc("/api/v1/store/items", requireMethod(http.MethodGet, handleStoreItems(authService, featureServices.Rewards)))
		mux.HandleFunc("/api/v1/store/purchases", requireMethod(http.MethodPost, handleStorePurchase(authService, featureServices.Rewards)))
	}
	mux.HandleFunc("/api/v1/users/", handleUserSocial(authService, userService, eventService, socialService, featureServices.Posts, featureServices.Rewards, featureServices.Moderation))
	mux.HandleFunc("/api/v1/events", handleEvents(authService, userService, eventService))
	mux.HandleFunc("/api/v1/events/categories", requireMethod(http.MethodGet, handleEventCategories(eventService)))
	mux.HandleFunc("/api/v1/events/recommendations", requireMethod(http.MethodGet, handleEventRecommendations(authService, eventService)))
	mux.HandleFunc("/api/v1/events/nearby", requireMethod(http.MethodGet, handleNearbyEvents(eventService)))
	mux.HandleFunc("/api/v1/events/viewport", requireMethod(http.MethodGet, handleViewportEvents(eventService)))
	mux.HandleFunc("/api/v1/events/", handleEvent(authService, eventService, groupService, socialService, featureServices.Posts, featureServices.Attendance))
	mux.HandleFunc("/api/v1/groups/", handleGroup(authService, groupService))
	if featureServices.Media != nil {
		mux.HandleFunc("/api/v1/media/images", requireMethod(http.MethodPost, handleMediaUpload(authService, featureServices.Media)))
		mux.HandleFunc("/api/v1/media/avatars", requireMethod(http.MethodPost, handleAvatarUpload(authService, featureServices.Media)))
		mux.HandleFunc("/api/v1/media/profile-images", requireMethod(http.MethodPost, handleProfileImageUpload(authService, featureServices.Media)))
		mux.HandleFunc("/api/v1/media/comment-images", requireMethod(http.MethodPost, handleCommentImageUpload(authService, featureServices.Media)))
		mux.HandleFunc("/api/v1/media/event-images", requireMethod(http.MethodPost, handleEventImageUpload(authService, featureServices.Media)))
		mux.HandleFunc("/api/v1/media/attendance-images", requireMethod(http.MethodPost, handleAttendanceImageUpload(authService, featureServices.Media)))
		mux.HandleFunc("/api/v1/media/comment-videos", requireMethod(http.MethodPost, handleCommentVideoUpload(authService, featureServices.Media)))
		mux.HandleFunc("/api/v1/media/clips", requireMethod(http.MethodPost, handleVideoUpload(authService, featureServices.Media, false)))
		mux.HandleFunc("/api/v1/media/videos", requireMethod(http.MethodPost, handleVideoUpload(authService, featureServices.Media, false)))
		mux.HandleFunc("/api/v1/media/", handleMedia(authService, featureServices.Media, config.MediaXAccel))
	}
	if featureServices.Posts != nil {
		mux.HandleFunc("/api/v1/users/me/posts", requireMethod(http.MethodGet, handleMyPosts(authService, featureServices.Posts)))
		mux.HandleFunc("/api/v1/feed", requireMethod(http.MethodGet, handleFeed(authService, featureServices.Posts)))
		mux.HandleFunc("/api/v1/posts", requireMethod(http.MethodPost, handleCreatePost(authService, featureServices.Posts)))
		mux.HandleFunc("GET /api/v1/posts/updates", handlePostUpdates(authService, featureServices.Posts))
		mux.HandleFunc("/api/v1/posts/", handlePost(authService, featureServices.Posts))
		mux.HandleFunc("/api/v1/comments/", handleComment(authService, featureServices.Posts))
	}
	if featureServices.Realtime != nil {
		mux.HandleFunc("/api/v1/realtime", requireMethod(http.MethodGet, handleRealtime(authService, featureServices.Realtime, config.Shutdown)))
	}
	if featureServices.Organizers != nil {
		mux.HandleFunc("/api/v1/organizers", handleOrganizers(authService, featureServices.Organizers))
		mux.HandleFunc("/api/v1/organizers/", handleOrganizer(authService, featureServices.Organizers))
		mux.HandleFunc("/api/v1/admin/organizers", requireMethod(http.MethodGet, handleOrganizerReviewList(authService, featureServices.Organizers)))
		mux.HandleFunc("/api/v1/admin/organizers/", handleOrganizerReview(authService, featureServices.Organizers))
	}
	if featureServices.Moderation != nil {
		mux.HandleFunc("/api/v1/support", handleSupport(authService, featureServices.Moderation, featureServices.Media))
		mux.HandleFunc("/api/v1/support/", handleSupport(authService, featureServices.Moderation, featureServices.Media))
		mux.HandleFunc("/api/v1/admin/", handleAdmin(authService, featureServices.Moderation, featureServices.Media))
		mux.HandleFunc("/api/v1/reports", requireMethod(http.MethodPost, handleCreateReport(authService, featureServices.Moderation)))
		mux.HandleFunc("/api/v1/moderation/", handleModeration(featureServices.Moderation, featureServices.Media, config))
	}
	mux.HandleFunc("/", handleNotFound)

	base := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := url.ParseQuery(r.URL.RawQuery); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_query", "Некорректные параметры запроса")
			return
		}
		if !sameOriginMutation(r, config.SecureCookies) {
			writeError(w, http.StatusForbidden, "cross_origin_request", "Запрос с другого сайта отклонён")
			return
		}
		if needsRegistration(r.URL.Path) {
			id, ok := authenticatedUserID(w, r, authService)
			if !ok {
				return
			}
			profile, err := userService.Get(r.Context(), id)
			if err != nil {
				writeError(w, 503, "profile_unavailable", "Не удалось загрузить профиль")
				return
			}
			if profile.OnboardingVersion < 1 {
				writeError(w, 403, "registration_required", "Сначала завершите регистрацию")
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
	limiter := newRateLimiter()
	var handler http.Handler = withUploadLimit(withMaintenance(authService, config, base))
	handler = withRateLimit(limiter, handler)
	handler = logRequests(logger, handler)
	handler = withRequestDeadline(handler)
	handler = withRequestID(handler)
	return withSecurityHeaders(handler)
}

func handleAppInfo(auth *maxauth.Service, config HandlerConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload := map[string]any{"demo_mode": config.LocalDemo, "moderation_url": config.ModerationURL}
		if username, err := auth.BotUsername(r.Context()); err == nil && username != "" {
			payload["max_bot_username"] = username
		}
		// Без бота обычный браузер всё равно должен узнать режим приложения.
		writeJSON(w, http.StatusOK, payload)
	}
}

func handleHealth(readinessCheck func(context.Context) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if readinessCheck != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := readinessCheck(ctx); err != nil {
				writeError(w, http.StatusServiceUnavailable, "not_ready", "Сервис временно не готов")
				return
			}
		}
		writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
	}
}
