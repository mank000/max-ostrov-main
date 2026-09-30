package rewards

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
)

type PostgresRepository struct{ db *sql.DB }

func NewPostgresRepository(db *sql.DB) *PostgresRepository { return &PostgresRepository{db: db} }

func (r *PostgresRepository) Wallet(ctx context.Context, userID int64) (Wallet, error) {
	var wallet Wallet
	err := r.db.QueryRowContext(ctx, `
		SELECT COALESCE(wallet.balance, 0), COALESCE(wallet.updated_at, u.created_at), kutezh_staff_role(u.id) = 'administrator'
		FROM users u LEFT JOIN coin_wallets wallet ON wallet.user_id = u.id
		WHERE u.id = $1`, userID).Scan(&wallet.Balance, &wallet.UpdatedAt, &wallet.Unlimited)
	if err != nil {
		return Wallet{}, fmt.Errorf("get coin wallet: %w", err)
	}
	return wallet, nil
}

func (r *PostgresRepository) Transactions(ctx context.Context, userID, beforeID int64, limit int) ([]Transaction, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, amount, kind, description, reference_type, reference_id, created_at, complimentary
		FROM coin_transactions WHERE user_id = $1 AND ($2 = 0 OR id < $2)
		ORDER BY id DESC LIMIT $3`, userID, beforeID, limit)
	if err != nil {
		return nil, fmt.Errorf("list coin transactions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := make([]Transaction, 0, limit)
	for rows.Next() {
		var item Transaction
		if err := rows.Scan(&item.ID, &item.Amount, &item.Kind, &item.Description, &item.ReferenceType, &item.ReferenceID, &item.CreatedAt, &item.Complimentary); err != nil {
			return nil, fmt.Errorf("scan coin transaction: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func mapBalanceError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23514" &&
		(pgErr.Message == "insufficient coin balance" || pgErr.ConstraintName == "coin_wallets_balance_check") {
		return ErrInsufficientBalance
	}
	return fmt.Errorf("write coin transaction: %w", err)
}
func sameID(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
