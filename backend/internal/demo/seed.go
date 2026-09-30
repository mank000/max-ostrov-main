//go:build demo

package demo

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
)

//go:embed seed.sql
var seedSQL string

// Это отдельная учебная база, не способ войти в существующую соцсеть.
func CheckDatabase(ctx context.Context, db *sql.DB) error {
	var usersExist, marked bool
	err := db.QueryRowContext(ctx, `SELECT to_regclass('public.users') IS NOT NULL,
  to_regclass('public.demo_installation') IS NOT NULL`).Scan(&usersExist, &marked)
	if err != nil {
		return err
	}
	if marked || !usersExist {
		return nil
	}
	var occupied bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM users)").Scan(&occupied); err != nil {
		return err
	}
	if occupied {
		return fmt.Errorf("demo refuses a database containing real users; use a new PostgreSQL volume")
	}
	return nil
}

func Seed(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(92710631)"); err != nil {
		return err
	}
	var marked bool
	if err := tx.QueryRowContext(ctx, "SELECT to_regclass('public.demo_installation') IS NOT NULL").Scan(&marked); err != nil {
		return err
	}
	if marked {
		return tx.Commit()
	}
	var occupied bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM users)").Scan(&occupied); err != nil {
		return err
	}
	if occupied {
		return fmt.Errorf("demo database is not empty")
	}
	// Маркер записывается вместе с данными. После аварии не останется полусобранного демо.
	if _, err := tx.ExecContext(ctx, seedSQL); err != nil {
		return fmt.Errorf("seed demo: %w", err)
	}
	return tx.Commit()
}
