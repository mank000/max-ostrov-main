package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const unusedMediaSQL = `NOT EXISTS (SELECT 1 FROM post_media WHERE media_id = media.id)
 AND NOT EXISTS (SELECT 1 FROM comment_media WHERE media_id = media.id)
 AND NOT EXISTS (SELECT 1 FROM attendance_media WHERE media_id = media.id)
 AND NOT EXISTS (SELECT 1 FROM moderation_evidence_media WHERE media_id = media.id)
 AND NOT EXISTS (SELECT 1 FROM users WHERE avatar_media_id = media.id)
 AND NOT EXISTS (SELECT 1 FROM user_profile_avatars WHERE media_id = media.id OR crop_media_id = media.id)
 AND NOT EXISTS (SELECT 1 FROM events WHERE media.id IN (header_source_media_id, header_media_id, icon_source_media_id, icon_media_id))`

func RunCleanup(ctx context.Context, db *sql.DB, directory string, logger *slog.Logger) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	for {
		for batch := 0; batch < 10 && ctx.Err() == nil; batch++ {
			count, err := removeUnusedMedia(ctx, db)
			if err != nil {
				logger.Warn("remove unused media", "error", err)
				break
			}
			if count == 0 {
				break
			}
		}
		if err := removeQueuedFiles(ctx, db, directory, logger); err != nil && ctx.Err() == nil {
			logger.Warn("clean media files", "error", err)
		}
		if err := removeAbandonedFiles(ctx, db, directory); err != nil && ctx.Err() == nil {
			logger.Warn("clean abandoned uploads", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func removeUnusedMedia(ctx context.Context, db *sql.DB) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id FROM media_assets media WHERE created_at < now() - interval '24 hours' AND `+unusedMediaSQL+` ORDER BY created_at, id LIMIT 100 FOR UPDATE OF media SKIP LOCKED`)
	if err != nil {
		return 0, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM media_assets media WHERE media.id = ANY($1::bigint[]) AND `+unusedMediaSQL, ids)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return count, tx.Commit()
}

func removeQueuedFiles(ctx context.Context, db *sql.DB, directory string, logger *slog.Logger) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `SELECT storage_key FROM media_file_cleanup WHERE run_at <= now() ORDER BY run_at LIMIT 1000`)
	if err != nil {
		return err
	}
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, key := range keys {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !validStorageKey(key) {
			logger.Error("invalid media cleanup key")
			continue
		}
		if err := os.Remove(filepath.Join(directory, key)); err != nil && !errors.Is(err, os.ErrNotExist) {
			logger.Warn("remove unused media file", "error", err)
			if _, err := db.ExecContext(ctx, `UPDATE media_file_cleanup SET attempts = attempts + 1, run_at = now() + interval '30 minutes' WHERE storage_key = $1`, key); err != nil {
				return err
			}
			continue
		}
		if _, err := db.ExecContext(ctx, `DELETE FROM media_file_cleanup WHERE storage_key = $1`, key); err != nil {
			return err
		}
	}
	return nil
}

func removeAbandonedFiles(ctx context.Context, db *sql.DB, directory string) error {
	dir, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer dir.Close()
	cutoff := time.Now().Add(-24 * time.Hour)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		entries, readErr := dir.ReadDir(128)
		for _, entry := range entries {
			if entry.Type()&os.ModeSymlink != 0 || entry.IsDir() {
				continue
			}
			info, err := entry.Info()
			if err != nil || !info.Mode().IsRegular() || !info.ModTime().Before(cutoff) {
				continue
			}
			name := entry.Name()
			temporary := strings.HasPrefix(name, ".upload-") || strings.HasPrefix(name, ".video-upload-") || strings.HasPrefix(name, ".health-")
			if !temporary && !validStorageKey(name) {
				continue
			}
			if !temporary {
				var exists bool
				lookup, cancel := context.WithTimeout(ctx, 3*time.Second)
				err := db.QueryRowContext(lookup, `SELECT EXISTS (SELECT 1 FROM media_assets WHERE storage_key = $1)`, name).Scan(&exists)
				cancel()
				if err != nil {
					return err
				}
				if exists {
					continue
				}
			}
			if err := os.Remove(filepath.Join(directory, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("remove abandoned upload: %w", err)
			}
		}
		if errors.Is(readErr, io.EOF) {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func validStorageKey(key string) bool {
	if len(key) < 36 || len(key) > 38 || filepath.Base(key) != key {
		return false
	}
	for _, c := range key[:32] {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	switch key[32:] {
	case ".jpg", ".png", ".mp4", ".mov":
		return true
	}
	return false
}

func ValidStorageKey(key string) bool { return validStorageKey(key) }
