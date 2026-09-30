//go:build !demo

package contentanalysis

import (
	"context"
	"database/sql"
	"kutezh/backend/internal/contentpolicy"
)

// Обычные посты ждут анализа; у клипов возрастная метка зависит только от подписи.
func EnqueuePost(ctx context.Context, tx *sql.Tx, postID int64) error {
	var caption string
	var isClip bool
	if err := tx.QueryRowContext(ctx, `
		SELECT
		    p.caption,
		    EXISTS (
		        SELECT
		            1
		        FROM clips clip
		        WHERE clip.post_id = p.id
		    )
		FROM posts p
		WHERE p.id = $1
	`, postID).Scan(&caption, &isClip); err != nil {
		return err
	}
	if isClip {
		restricted := contentpolicy.SensitiveLanguage(caption)
		if _, err := tx.ExecContext(ctx, `
			UPDATE posts
			SET adult_only = $2,
			    age_classified = true
			WHERE id = $1
		`,
			postID, restricted,
		); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM post_analysis_jobs
			WHERE post_id = $1
		`, postID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `
			UPDATE moderation_reports
			SET status = 'dismissed',
			    version = version + 1
			WHERE target_type = 'post'
			    AND target_id = $1
			    AND source = 'ai'
			    AND status = 'open'
		`,
			postID,
		)
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE posts
		SET adult_only = true,
		    age_classified = false
		WHERE id = $1
	`, postID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO
		    post_analysis_jobs (post_id)
		VALUES
		    ($1)
		ON CONFLICT (post_id) DO UPDATE
		SET revision = post_analysis_jobs.revision + 1,
		    state = 'pending',
		    attempts = 0,
		    run_at = now(),
		    lease_until = NULL,
		    lease_token = NULL,
		    result = NULL,
		    last_error = '',
		    updated_at = now()
	`, postID)
	return err
}
