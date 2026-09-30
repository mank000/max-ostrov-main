package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) Create(
	ctx context.Context,
	ownerID int64,
	key, mimeType string,
	byteSize int64,
	width, height, durationMS int,
) (Asset, error) {
	var asset Asset
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO
		    media_assets (
		        owner_user_id,
		        storage_key,
		        mime_type,
		        byte_size,
		        width,
		        height,
		        duration_ms
		    )
		VALUES
		    ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id,
		    storage_key,
		    mime_type,
		    byte_size,
		    width,
		    height,
		    duration_ms,
		    created_at
	`,
		ownerID, key, mimeType, byteSize, width, height, durationMS,
	).Scan(&asset.ID, &asset.StorageKey, &asset.MIMEType, &asset.ByteSize, &asset.Width, &asset.Height, &asset.DurationMS, &asset.CreatedAt)
	if err != nil {
		return Asset{}, fmt.Errorf("create media asset: %w", err)
	}
	return asset, nil
}

func (r *PostgresRepository) ApproveModerated(ctx context.Context, mediaID int64) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE media_assets
		SET moderated_safe = true
		WHERE id = $1
	`, mediaID)
	if err != nil {
		return fmt.Errorf("approve moderated media: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check moderated media approval: %w", err)
	}
	if changed != 1 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) GetReadable(ctx context.Context, userID, mediaID int64) (Asset, error) {
	var asset Asset
	err := r.db.QueryRowContext(ctx, getReadableSQL, userID, mediaID).Scan(&asset.ID, &asset.StorageKey, &asset.MIMEType, &asset.ByteSize, &asset.Width, &asset.Height, &asset.DurationMS, &asset.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Asset{}, ErrNotFound
	}
	if err != nil {
		return Asset{}, fmt.Errorf("get media asset: %w", err)
	}
	return asset, nil
}

func (r *PostgresRepository) Delete(ctx context.Context, ownerID, mediaID int64) (Asset, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Asset{}, fmt.Errorf("begin media removal: %w", err)
	}
	defer tx.Rollback()
	var lockedID int64
	err = tx.QueryRowContext(ctx, `
		SELECT
		    id
		FROM media_assets
		WHERE id = $1
		    AND owner_user_id = $2
		FOR UPDATE
	`, mediaID, ownerID).Scan(&lockedID)
	if errors.Is(err, sql.ErrNoRows) {
		return Asset{}, ErrNotFound
	}
	if err != nil {
		return Asset{}, fmt.Errorf("lock media removal: %w", err)
	}
	var asset Asset
	err = tx.QueryRowContext(ctx, `
		DELETE FROM media_assets media
		WHERE media.id = $2
		    AND media.owner_user_id = $1
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM post_media
		        WHERE media_id = media.id
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM comment_media
		        WHERE media_id = media.id
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM attendance_media
		        WHERE media_id = media.id
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM moderation_evidence_media
		        WHERE media_id = media.id
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM events
		        WHERE media.id IN (
		                header_source_media_id,
		                header_media_id,
		                icon_source_media_id,
		                icon_media_id
		            )
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM users
		        WHERE avatar_media_id = media.id
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM user_profile_avatars
		        WHERE media_id = media.id
		            OR crop_media_id = media.id
		    )
		RETURNING id,
		    storage_key,
		    mime_type,
		    byte_size,
		    width,
		    height,
		    duration_ms,
		    created_at
	`, ownerID, mediaID,
	).Scan(&asset.ID, &asset.StorageKey, &asset.MIMEType, &asset.ByteSize, &asset.Width, &asset.Height, &asset.DurationMS, &asset.CreatedAt)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return Asset{}, fmt.Errorf("commit media removal: %w", err)
		}
		return asset, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		var constraintError *pgconn.PgError
		if errors.As(err, &constraintError) && constraintError.Code == "23503" {
			return Asset{}, ErrInUse
		}
		return Asset{}, fmt.Errorf("delete media asset: %w", err)
	}
	var inUse bool
	err = tx.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM media_assets media
		        WHERE media.id = $2
		            AND media.owner_user_id = $1
		            AND (
		                EXISTS (
		                    SELECT
		                        1
		                    FROM post_media
		                    WHERE media_id = media.id
		                )
		                OR EXISTS (
		                    SELECT
		                        1
		                    FROM comment_media
		                    WHERE media_id = media.id
		                )
		                OR EXISTS (
		                    SELECT
		                        1
		                    FROM attendance_media
		                    WHERE media_id = media.id
		                )
		                OR EXISTS (
		                    SELECT
		                        1
		                    FROM moderation_evidence_media
		                    WHERE media_id = media.id
		                )
		                OR EXISTS (
		                    SELECT
		                        1
		                    FROM events
		                    WHERE media.id IN (
		                            header_source_media_id,
		                            header_media_id,
		                            icon_source_media_id,
		                            icon_media_id
		                        )
		                )
		                OR EXISTS (
		                    SELECT
		                        1
		                    FROM users
		                    WHERE avatar_media_id = media.id
		                )
		                OR EXISTS (
		                    SELECT
		                        1
		                    FROM user_profile_avatars
		                    WHERE media_id = media.id
		                        OR crop_media_id = media.id
		                )
		            )
		    )
	`, ownerID, mediaID,
	).Scan(&inUse)
	if err != nil {
		return Asset{}, fmt.Errorf("check media use: %w", err)
	}
	if inUse {
		return Asset{}, ErrInUse
	}
	return Asset{}, ErrNotFound
}
