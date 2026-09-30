package rewards

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"time"
)

func (r *PostgresRepository) Items(ctx context.Context) ([]Item, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
		    code,
		    kind,
		    title,
		    description,
		    coin_price,
		    duration_hours
		FROM store_items
		WHERE active
		ORDER BY
		    coin_price,
		    code
	`)
	if err != nil {
		return nil, fmt.Errorf("list store items: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()
	items := []Item{}
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.Code, &item.Kind, &item.Title, &item.Description, &item.CoinPrice, &item.DurationHours); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// Покупка, списание и выдача живут в одной транзакции. Если не хватило
// монет, не должно остаться ни покупки, ни занятого места в инвентаре.
func (r *PostgresRepository) Purchase(ctx context.Context, userID int64, input PurchaseInput, now time.Time) (Purchase, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Purchase{}, fmt.Errorf("begin store purchase: %w", err)
	}
	defer tx.Rollback()

	previous, err := purchaseByKey(ctx, tx, userID, input)
	if err == nil {
		return previous, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Purchase{}, err
	}

	item, err := purchaseItem(ctx, tx, input.ItemCode)
	if err != nil {
		return Purchase{}, err
	}
	if err := validatePurchaseItem(item, input); err != nil {
		return Purchase{}, err
	}
	if item.Kind == "event_boost" {
		if err := authorizeEventBoost(ctx, tx, userID, *input.TargetEventID, now); err != nil {
			return Purchase{}, err
		}
	}

	purchase, err := insertPurchase(ctx, tx, userID, item.Code, input, now)
	if errors.Is(err, sql.ErrNoRows) {
		// Другой запрос мог вставить тот же ключ, пока мы читали товар.
		// Возвращаем его результат, не повторяя списание и выдачу.
		previous, err := purchaseByKey(ctx, tx, userID, input)
		if err != nil {
			return Purchase{}, fmt.Errorf("read concurrent purchase: %w", err)
		}
		return previous, tx.Commit()
	}
	if err != nil {
		return Purchase{}, err
	}

	if item.Kind == "profile_decoration" {
		if err := reserveDecoration(ctx, tx, userID, item.Code, now); err != nil {
			return Purchase{}, err
		}
	}
	if err := chargePurchase(ctx, tx, userID, item, purchase.ID, input.IdempotencyKey, now); err != nil {
		return Purchase{}, err
	}
	if err := applyPurchase(ctx, tx, userID, item, input, &purchase, now); err != nil {
		return Purchase{}, err
	}
	if err := tx.Commit(); err != nil {
		return Purchase{}, fmt.Errorf("commit store purchase: %w", err)
	}
	return purchase, nil
}

func purchaseByKey(ctx context.Context, tx *sql.Tx, userID int64, input PurchaseInput) (Purchase, error) {
	var purchase Purchase
	err := tx.QueryRowContext(ctx, `
  SELECT id, item_code, target_event_id, expires_at, created_at
  FROM store_purchases WHERE user_id = $1 AND idempotency_key = $2
 `, userID, input.IdempotencyKey).Scan(&purchase.ID, &purchase.ItemCode,
		&purchase.TargetEventID, &purchase.ExpiresAt, &purchase.CreatedAt)
	if err != nil {
		return Purchase{}, fmt.Errorf("read previous purchase: %w", err)
	}
	if purchase.ItemCode != input.ItemCode || !sameID(purchase.TargetEventID, input.TargetEventID) {
		return Purchase{}, ErrIdempotencyConflict
	}
	return purchase, nil
}

func purchaseItem(ctx context.Context, tx *sql.Tx, code string) (Item, error) {
	var item Item
	err := tx.QueryRowContext(ctx, `
  SELECT code, kind, title, description, coin_price, duration_hours
  FROM store_items WHERE code = $1 AND active FOR SHARE
 `, code).Scan(&item.Code, &item.Kind, &item.Title, &item.Description, &item.CoinPrice, &item.DurationHours)
	if errors.Is(err, sql.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, fmt.Errorf("get store item: %w", err)
	}
	return item, nil
}

func authorizeEventBoost(ctx context.Context, tx *sql.Tx, userID, eventID int64, now time.Time) error {
	var allowed bool
	err := tx.QueryRowContext(ctx, `
  SELECT EXISTS (
   SELECT 1 FROM events event
   LEFT JOIN organizer_profiles organizer ON organizer.id = event.organizer_profile_id
   WHERE event.id = $1 AND COALESCE(event.ends_at, event.starts_at) >= $3
    AND (event.created_by_user_id = $2 OR (organizer.owner_user_id = $2 AND organizer.status = 'verified'))
  )
 `, eventID, userID, now).Scan(&allowed)
	if err != nil {
		return fmt.Errorf("authorize event boost: %w", err)
	}
	if !allowed {
		return ErrForbidden
	}
	return nil
}

func insertPurchase(ctx context.Context, tx *sql.Tx, userID int64, code string, input PurchaseInput, now time.Time) (Purchase, error) {
	var purchase Purchase
	err := tx.QueryRowContext(ctx, `
  INSERT INTO store_purchases (user_id, item_code, target_event_id, idempotency_key, created_at)
  VALUES ($1, $2, $3, $4, $5)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id, item_code, target_event_id, expires_at, created_at
 `, userID, code, input.TargetEventID, input.IdempotencyKey, now).
		Scan(&purchase.ID, &purchase.ItemCode, &purchase.TargetEventID, &purchase.ExpiresAt, &purchase.CreatedAt)
	if err != nil {
		return Purchase{}, fmt.Errorf("create store purchase: %w", err)
	}
	return purchase, nil
}

func reserveDecoration(ctx context.Context, tx *sql.Tx, userID int64, code string, now time.Time) error {
	result, err := tx.ExecContext(ctx, `
  INSERT INTO user_inventory (user_id, item_code, purchased_at) VALUES ($1, $2, $3)
  ON CONFLICT DO NOTHING
 `, userID, code, now)
	if err != nil {
		return fmt.Errorf("reserve profile decoration: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if inserted == 0 {
		return ErrAlreadyOwned
	}
	return nil
}

func chargePurchase(ctx context.Context, tx *sql.Tx, userID int64, item Item, purchaseID int64, key string, now time.Time) error {
	_, err := tx.ExecContext(ctx, `
  INSERT INTO coin_transactions (user_id, amount, kind, description, reference_type, reference_id, idempotency_key, created_at)
  VALUES ($1, $2, 'store_purchase', $3, 'store_purchase', $4, $5, $6)
 `, userID, -item.CoinPrice, "Покупка: "+item.Title, strconv.FormatInt(purchaseID, 10), "purchase:"+key, now)
	if err != nil {
		return mapBalanceError(err)
	}
	return nil
}

func applyPurchase(ctx context.Context, tx *sql.Tx, userID int64, item Item, input PurchaseInput, purchase *Purchase, now time.Time) error {
	var err error
	switch item.Kind {
	case "profile_decoration":
		_, err = tx.ExecContext(ctx, `
			UPDATE users
			SET equipped_decoration_code = COALESCE(equipped_decoration_code, $2),
			    updated_at = $3
			WHERE id = $1
		`, userID, item.Code, now)
	case "profile_boost":
		expires := now.Add(time.Duration(*item.DurationHours) * time.Hour)
		err = tx.QueryRowContext(ctx, `
			INSERT INTO
			    profile_boosts (user_id, starts_at, ends_at)
			VALUES
			    ($1, $2, $3)
			ON CONFLICT (user_id) DO UPDATE
			SET starts_at = LEAST(profile_boosts.starts_at, $2),
			    ends_at = GREATEST(profile_boosts.ends_at, $2) + ($3 - $2)
			RETURNING ends_at
		`, userID, now, expires).Scan(&expires)
		purchase.ExpiresAt = &expires
	case "event_boost":
		expires := now.Add(time.Duration(*item.DurationHours) * time.Hour)
		err = tx.QueryRowContext(ctx, `
			INSERT INTO
			    event_boosts (event_id, purchased_by_user_id, starts_at, ends_at)
			VALUES
			    ($1, $2, $3, $4)
			ON CONFLICT (event_id) DO UPDATE
			SET purchased_by_user_id = $2,
			    starts_at = LEAST(event_boosts.starts_at, $3),
			    ends_at = GREATEST(event_boosts.ends_at, $3) + ($4 - $3)
			RETURNING ends_at
		`, *input.TargetEventID, userID, now, expires).Scan(&expires)
		purchase.ExpiresAt = &expires
	}
	if err != nil {
		return fmt.Errorf("apply store purchase: %w", err)
	}
	if purchase.ExpiresAt != nil {
		if _, err := tx.ExecContext(ctx, `
			UPDATE store_purchases
			SET expires_at = $2
			WHERE id = $1
		`, purchase.ID, purchase.ExpiresAt); err != nil {
			return fmt.Errorf("record purchase expiration: %w", err)
		}
	}
	return nil
}

func (r *PostgresRepository) SetDecoration(ctx context.Context, userID int64, code string) error {
	if code == "" {
		_, err := r.db.ExecContext(ctx, `
			UPDATE users
			SET equipped_decoration_code = NULL,
			    updated_at = now()
			WHERE id = $1
		`, userID)
		return err
	}
	result, err := r.db.ExecContext(ctx, `
		UPDATE users
		SET equipped_decoration_code = $2,
		    updated_at = now()
		WHERE id = $1
		    AND EXISTS (
		        SELECT
		            1
		        FROM user_inventory
		        WHERE user_id = $1
		            AND item_code = $2
		    )
	`, userID, code)
	if err != nil {
		return fmt.Errorf("equip profile decoration: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
