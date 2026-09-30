package postgres

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

func RunCleanup(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		cleanExpired(ctx, db, logger)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func cleanExpired(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	queries := []string{
		`DELETE FROM realtime_post_watchers WHERE (post_id, user_id) IN (
   SELECT post_id, user_id FROM realtime_post_watchers WHERE seen_at < now() - interval '2 minutes'
   ORDER BY seen_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
		`DELETE FROM auth_sessions WHERE token_hash IN (
			SELECT token_hash FROM auth_sessions WHERE expires_at <= now()
			ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
		`DELETE FROM ranked_feed_snapshots WHERE id IN (
			SELECT id FROM ranked_feed_snapshots WHERE expires_at <= now()
			ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`,
		`DELETE FROM ranked_comment_snapshots WHERE id IN (
			SELECT id FROM ranked_comment_snapshots WHERE expires_at <= now()
			ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)`,
		`DELETE FROM moderation_login_challenges WHERE id IN (
   SELECT id FROM moderation_login_challenges WHERE expires_at < now() - interval '24 hours'
   ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
		`DELETE FROM moderation_sessions WHERE token_hash IN (
   SELECT token_hash FROM moderation_sessions WHERE expires_at <= now()
   ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
		`UPDATE background_jobs SET finished_at = now(), locked_at = NULL,
   last_error = CASE WHEN last_error = '' THEN 'worker lease expired after last attempt' ELSE last_error END
   WHERE id IN (SELECT id FROM background_jobs WHERE finished_at IS NULL AND attempts >= 5
   AND (locked_at IS NULL OR locked_at < now() - interval '5 minutes') LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
		`DELETE FROM background_jobs WHERE id IN (
   SELECT id FROM background_jobs WHERE finished_at < now() - interval '90 days'
   ORDER BY finished_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
		`DELETE FROM notification_bot_deliveries WHERE (notification_id, provider, provider_user_id) IN (
   SELECT notification_id, provider, provider_user_id FROM notification_bot_deliveries
   WHERE delivered_at < now() - interval '30 days'
    OR (attempts >= 5 AND next_attempt_at < now() - interval '90 days')
   ORDER BY next_attempt_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
	}
	for _, query := range queries {
		for batch := 0; batch < 10 && ctx.Err() == nil; batch++ {
			timeout, cancel := context.WithTimeout(ctx, 5*time.Second)
			result, err := db.ExecContext(timeout, query)
			cancel()
			if err != nil {
				if ctx.Err() == nil {
					logger.Warn("remove expired records", "error", err)
				}
				break
			}
			count, err := result.RowsAffected()
			if err != nil || count == 0 {
				break
			}
		}
	}
}
