package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"kutezh/backend/internal/config"
	"kutezh/backend/internal/moderation"
	"kutezh/backend/internal/postgres"
)

func main() {
	maxID := flag.Int64("max-id", 0, "verified MAX provider user ID")
	role := flag.String("role", "", "moderator or administrator")
	operation := flag.String("operation", "grant", "grant or revoke")
	reason := flag.String("reason", "", "operator reason (8-500 characters)")
	flag.Parse()
	if err := changeRole(*maxID, *role, *operation, *reason); err != nil {
		log.Fatal(err)
	}
}

func changeRole(maxID int64, role, operation, reason string) error {
	if maxID <= 0 || role == "" || reason == "" {
		return fmt.Errorf("max-id, role and reason are required")
	}
	// В контейнере пароль лежит в файле, а не в DATABASE_URL.
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := postgres.Migrate(ctx, db); err != nil {
		return err
	}
	service := moderation.NewService(db, nil, nil, "")
	userID, err := service.ChangeRole(ctx, 0, maxID, role, operation, reason)
	if err != nil {
		return err
	}
	fmt.Printf("%s %s for verified MAX identity %d (internal user %d)\n", operation, role, maxID, userID)
	return nil
}
