//go:build demo

package main

import (
	"context"
	"database/sql"
	"fmt"
	"kutezh/backend/internal/config"
	"kutezh/backend/internal/demo"
	"kutezh/backend/internal/httpapi"
	"kutezh/backend/internal/maxauth"
	"net/http"
)

const demoBuild = true

func checkBuildConfig(cfg config.Config) error {
	if cfg.MaxBotToken != "" || cfg.ModerationHost != "" || cfg.SessionCookieSecure || cfg.TextAIMode != "off" {
		return fmt.Errorf("demo binary only accepts local settings without a bot token or moderation domain; use the production Docker target")
	}
	return nil
}

func checkDatabaseMode(ctx context.Context, db *sql.DB) error { return demo.CheckDatabase(ctx, db) }

func prepareDemo(ctx context.Context, db *sql.DB, auth *maxauth.Service) (func(*http.ServeMux), error) {
	if err := demo.Seed(ctx, db); err != nil {
		return nil, err
	}
	return func(mux *http.ServeMux) { httpapi.RegisterDemoRoutes(mux, db, auth) }, nil
}
