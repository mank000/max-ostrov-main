package postgres

import (
	"context"
	"database/sql"
	"fmt"
)

func LockMediaAssets(ctx context.Context, tx *sql.Tx, ownerID int64, mediaIDs []int64) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM media_assets
		WHERE owner_user_id = $1 AND id = ANY($2::bigint[])
		ORDER BY id FOR UPDATE`, ownerID, mediaIDs)
	if err != nil {
		return fmt.Errorf("lock media assets: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan locked media asset: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate locked media assets: %w", err)
	}
	return rows.Close()
}
