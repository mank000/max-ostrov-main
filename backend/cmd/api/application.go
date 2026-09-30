package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"kutezh/backend/internal/attendance"
	"kutezh/backend/internal/config"
	"kutezh/backend/internal/contentanalysis"
	datingstore "kutezh/backend/internal/dating"
	"kutezh/backend/internal/events"
	"kutezh/backend/internal/games"
	"kutezh/backend/internal/groups"
	"kutezh/backend/internal/httpapi"
	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/media"
	"kutezh/backend/internal/moderation"
	"kutezh/backend/internal/notifications"
	"kutezh/backend/internal/organizers"
	"kutezh/backend/internal/postgres"
	"kutezh/backend/internal/posts"
	"kutezh/backend/internal/realtime"
	"kutezh/backend/internal/rewards"
	"kutezh/backend/internal/social"
	"kutezh/backend/internal/users"
	"kutezh/backend/internal/verification"
	dating "kutezh/dating"
	"log/slog"
	"net/http"
	"time"
)

func buildApplication(workerCtx context.Context, cfg config.Config, db *sql.DB, logger *slog.Logger) (*http.Server, []func(context.Context), error) {
	userService := users.NewService(users.NewPostgresRepository(db))
	eventService := events.NewService(events.NewPostgresRepository(db))
	groupService := groups.NewService(groups.NewPostgresRepository(db))
	socialService := social.NewService(social.NewPostgresRepository(db))
	realtimeBroker, err := realtime.NewPostgresBroker(db, cfg.DatabaseURL, logger)
	if err != nil {
		return nil, nil, err
	}
	contentAnalyzer := contentanalysis.NewAnalyzer(cfg.ImageAIURL, cfg.TextAIURL, cfg.MediaDirectory)
	mediaService, err := media.NewService(media.NewPostgresRepository(db), cfg.MediaDirectory)
	if err != nil {
		return nil, nil, fmt.Errorf("open media storage: %w", err)
	}
	mediaService.WithAnalyzer(contentAnalyzer)
	postService := posts.NewService(posts.NewPostgresRepository(db), realtimeBroker)
	attendanceService := attendance.NewService(attendance.NewPostgresRepository(db), realtimeBroker)
	notificationService := notifications.NewService(notifications.NewPostgresRepository(db))
	rewardService := rewards.NewService(rewards.NewPostgresRepository(db), realtimeBroker)
	organizerService := organizers.NewService(organizers.NewPostgresRepository(db), eventService, realtimeBroker)
	moderationService := moderation.NewService(db,
		moderation.NewMAXSender(cfg.MaxBotToken),
		[]byte(cfg.ModerationOTPKey), cfg.MediaDirectory).WithRealtime(realtimeBroker)
	datingService := dating.NewService(datingstore.NewRepository(db, datingstore.SharedPlatform{
		Social:     socialService,
		Moderation: moderationService,
		Realtime:   realtimeBroker,
	}), dating.Config{
		LinkFriends: socialService.CreateFriendship,
		OpenChat: func(ctx context.Context, a, b int64) (dating.ChatTarget, error) {
			target, err := socialService.DirectMessageTarget(ctx, a, b)
			if errors.Is(err, social.ErrFriendshipRequired) {
				return dating.ChatTarget{}, &dating.ServiceError{
					Status: http.StatusForbidden,
					Detail: "Для переписки нужна действующая общая дружба",
				}
			}
			return dating.ChatTarget{MaxChatID: target.MAXChatID}, err
		},
	})
	verificationService := verification.NewService(db, cfg.FaceAIURL, mediaService)
	authConfig := maxauth.Config{
		BotToken: cfg.MaxBotToken,
		MaxAge:   cfg.MaxAuthMaxAge,
		TTL:      cfg.SessionTTL,
		Store:    maxauth.NewPostgresSessionStore(db),
	}
	// Подпись медиа-ссылок не требует настоящего бота в локальном демо.
	// В production оставляем прежний ключ, чтобы не сломать выданные ссылки.
	if demoBuild {
		authConfig.ResourceKey = []byte(cfg.ModerationOTPKey)
	}
	authService := maxauth.NewService(authConfig)

	extraRoutes, err := prepareDemo(workerCtx, db, authService)
	if err != nil {
		return nil, nil, err
	}
	server := &http.Server{
		Addr: cfg.HTTPAddress,
		Handler: httpapi.NewHandler(
			logger,
			authService,
			userService,
			eventService,
			groupService,
			socialService,
			httpapi.HandlerConfig{
				ExtraRoutes:           extraRoutes,
				ModerationURL:         cfg.ModerationURL,
				LocalDemo:             demoBuild,
				SecureCookies:         cfg.SessionCookieSecure,
				MaintenanceAllowedIDs: cfg.MaintenanceAllowedIDs,
				ModerationHost:        cfg.ModerationHost,
				GeocodingURL:          cfg.GeocodingURL,
				GeocodingAutocomplete: cfg.GeocodingAutocomplete,
				MediaXAccel:           cfg.MediaXAccel,
				Shutdown:              workerCtx.Done(),
				ReadinessCheck: func(ctx context.Context) error {
					if err := db.PingContext(ctx); err != nil {
						return fmt.Errorf("database: %w", err)
					}
					if err := mediaService.Ready(); err != nil {
						return fmt.Errorf("media storage: %w", err)
					}
					return nil
				},
			},
			httpapi.FeatureServices{
				Dating:        datingService,
				Games:         games.NewService(db, realtimeBroker),
				Media:         mediaService,
				Clips:         posts.NewClipService(posts.NewPostgresRepository(db), realtimeBroker),
				Posts:         postService,
				Attendance:    attendanceService,
				Notifications: notificationService,
				Realtime:      realtimeBroker,
				Rewards:       rewardService,
				Organizers:    organizerService,
				Moderation:    moderationService,
				Verification:  verificationService,
			},
		),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       185 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	analysisWorker := contentanalysis.NewWorker(db, contentAnalyzer, logger)
	notificationWorker := notifications.NewWorker(db, realtimeBroker, logger).WithBotDelivery(cfg.MaxBotToken)
	botWorker := moderation.NewBotWorker(moderationService, cfg.MaxBotToken, cfg.SupportOwnerMAXID, logger).WithPublicURL(cfg.PublicURL)
	background := []func(context.Context){
		func(ctx context.Context) {
			postgres.RunCleanup(ctx, db, logger)
		},
		func(ctx context.Context) {
			media.RunCleanup(ctx, db, cfg.MediaDirectory, logger)
		},
		realtimeBroker.Run,
		notificationWorker.Run,
		notificationWorker.RunBirthdayReminders,
		notificationWorker.RunBotDelivery,
		botWorker.Run,
	}
	if !demoBuild {
		background = append(background, analysisWorker.Run)
	}
	return server, background, nil
}
