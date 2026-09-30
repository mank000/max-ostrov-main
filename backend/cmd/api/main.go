package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"kutezh/backend/internal/config"
	"kutezh/backend/internal/contentpolicy"
	"kutezh/backend/internal/postgres"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("API stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	if err := checkBuildConfig(cfg); err != nil {
		return err
	}
	contentpolicy.Configure(cfg.TextAIURL, cfg.TextAIMode)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	startup, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	db, err := postgres.Open(startup, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := checkDatabaseMode(startup, db); err != nil {
		return err
	}
	if err := postgres.Migrate(startup, db); err != nil {
		return err
	}
	cancel()

	workerCtx, stopWorkers := context.WithCancel(ctx)
	defer stopWorkers()
	server, workers, err := buildApplication(workerCtx, cfg, db, logger)
	if err != nil {
		return err
	}
	return serve(ctx, workerCtx, stopWorkers, server, workers, cfg.ShutdownTimeout, logger)
}
