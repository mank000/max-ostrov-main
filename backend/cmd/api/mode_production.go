//go:build !demo

package main

import (
	"context"
	"database/sql"
	"fmt"
	"kutezh/backend/internal/config"
	"kutezh/backend/internal/maxauth"
	"net/http"
)

const demoBuild = false

func checkBuildConfig(config.Config) error { return nil }

func checkDatabaseMode(ctx context.Context, db *sql.DB) error {
	var demo bool
	if err := db.QueryRowContext(ctx, "SELECT to_regclass('public.demo_installation') IS NOT NULL").Scan(&demo); err != nil {
		return err
	}
	if demo {
		return fmt.Errorf("refusing to use a demo database in production; choose a separate PostgreSQL volume")
	}
	return nil
}

func prepareDemo(context.Context, *sql.DB, *maxauth.Service) (func(*http.ServeMux), error) {
	return nil, nil
}
