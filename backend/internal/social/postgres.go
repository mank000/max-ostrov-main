package social

import (
	"context"
	"database/sql"
	"fmt"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

type scanner interface {
	Scan(...any) error
}

func scanUser(row scanner, user *User, additional ...any) error {
	return row.Scan(append([]any{
		&user.ID, &user.Username, &user.DisplayName, &user.City, &user.PhotoURL,
	}, additional...)...)
}

func lockUsers(ctx context.Context, tx *sql.Tx, firstID, secondID int64) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM users WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`, firstID, secondID)
	if err != nil {
		return fmt.Errorf("lock users: %w", err)
	}
	defer func() { _ = rows.Close() }()
	count := 0
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan locked user: %w", err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate locked users: %w", err)
	}
	if count != 2 {
		return ErrNotFound
	}
	return nil
}

func usersBlocked(ctx context.Context, tx *sql.Tx, firstID, secondID int64) (bool, error) {
	var blocked bool
	err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_blocks
			WHERE (blocker_id = $1 AND blocked_id = $2)
				OR (blocker_id = $2 AND blocked_id = $1)
		)`, firstID, secondID).Scan(&blocked)
	if err != nil {
		return false, fmt.Errorf("check user blocks: %w", err)
	}
	return blocked, nil
}

func commit(tx *sql.Tx, operation string) error {
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit %s: %w", operation, err)
	}
	return nil
}
