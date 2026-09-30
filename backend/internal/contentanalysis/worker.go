package contentanalysis

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"kutezh/backend/internal/contentpolicy"
)

const ImageVersion = "6c9964d418b39c3c59f4dd141a54f44445d7c9d573178fa89ce2c4074093e83b"
const ImageCacheVersion = ImageVersion + ":anatomy-thresholds-20260928-v2"
const maxAttempts = 8

type Worker struct {
	db       *sql.DB
	analyzer *Analyzer
	logger   *slog.Logger
}
type job struct {
	PostID, Revision int64
	Attempt          int
	Token            string
}
type asset struct {
	ID         int64  `json:"id"`
	Key        string `json:"-"`
	MIME       string `json:"mime_type"`
	DurationMS int    `json:"duration_ms,omitempty"`
}
type imageResult struct {
	MediaID  int64    `json:"media_id"`
	Analysis Analysis `json:"analysis"`
}
type result struct {
	Revision            int64         `json:"revision"`
	AdultOnly           bool          `json:"adult_only"`
	AuthorAdultRequired bool          `json:"author_adult_required,omitempty"`
	Complete            bool          `json:"complete"`
	Text                *Analysis     `json:"text,omitempty"`
	Images              []imageResult `json:"images"`
	Videos              []videoResult `json:"videos,omitempty"`
	Skipped             []int64       `json:"skipped_video_ids"`
	Review              []string      `json:"review_labels"`
	Block               []string      `json:"block_labels,omitempty"`
}

func NewWorker(db *sql.DB, analyzer *Analyzer, logger *slog.Logger) *Worker {
	return &Worker{
		db:       db,
		analyzer: analyzer,
		logger:   logger,
	}
}

func (w *Worker) Run(ctx context.Context) {
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		processed, err := w.runNext(ctx)
		if err != nil && ctx.Err() == nil {
			w.logger.Warn("post analysis retry", "error", err)
		}
		if processed && err == nil {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}
func (w *Worker) claim(ctx context.Context) (job, error) {
	var j job
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return j, err
	}
	j.Token = hex.EncodeToString(token)
	err := w.db.QueryRowContext(ctx, `
		WITH
		    next AS (
		        SELECT
		            post_id
		        FROM post_analysis_jobs
		        WHERE (
		                state = 'pending'
		                AND run_at <= now()
		            )
		            OR (
		                state = 'processing'
		                AND lease_until < now()
		            )
		        ORDER BY
		            run_at,
		            post_id
		        LIMIT 1
		        FOR UPDATE
		            SKIP LOCKED
		    )
		UPDATE post_analysis_jobs j
		SET state = 'processing',
		    attempts = attempts + 1,
		    lease_until = now() + interval '2 minutes',
		    lease_token = $1,
		    updated_at = now()
		FROM next
		WHERE j.post_id = next.post_id
		RETURNING j.post_id,
		    j.revision,
		    j.attempts
	`, j.Token).Scan(&j.PostID, &j.Revision, &j.Attempt)
	return j, err
}
func (w *Worker) runNext(ctx context.Context) (bool, error) {
	j, err := w.claim(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	workCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	out, err := w.analyze(workCtx, j)
	if err == nil {
		err = w.finish(workCtx, j, out, "")
	}
	cancel()
	if err != nil {

		retryCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer stop()
		if retryErr := w.fail(retryCtx, j, err); retryErr != nil {
			return true, retryErr
		}
	}
	return true, err
}
func (w *Worker) snapshot(ctx context.Context, j job) (string, []asset, bool, error) {
	tx, err := w.db.BeginTx(ctx, &sql.TxOptions{
		ReadOnly:  true,
		Isolation: sql.LevelRepeatableRead,
	})
	if err != nil {
		return "", nil, false, err
	}
	defer tx.Rollback()
	var caption string
	var isClip bool
	err = tx.QueryRowContext(ctx, `
		SELECT
		    p.caption,
		    EXISTS (
		        SELECT
		            1
		        FROM clips clip
		        WHERE clip.post_id = p.id
		    )
		FROM posts p
		    JOIN post_analysis_jobs j ON j.post_id = p.id
		WHERE p.id = $1
		    AND j.revision = $2
		    AND j.lease_token = $3
	`, j.PostID, j.Revision, j.Token).Scan(&caption, &isClip)
	if err != nil {
		return "", nil, false, err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT
		    m.id,
		    m.storage_key,
		    m.mime_type,
		    m.duration_ms
		FROM post_media p
		    JOIN media_assets m ON m.id = p.media_id
		WHERE p.post_id = $1
		ORDER BY
		    p.position
	`, j.PostID)
	if err != nil {
		return "", nil, false, err
	}
	media := []asset{}
	for rows.Next() {
		var a asset
		if err = rows.Scan(&a.ID, &a.Key, &a.MIME, &a.DurationMS); err != nil {
			rows.Close()
			return "", nil, false, err
		}
		media = append(media, a)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", nil, false, err
	}
	return caption, media, isClip, tx.Commit()
}
func (w *Worker) analyze(ctx context.Context, j job) (result, error) {
	out := result{
		Revision: j.Revision,
		Images:   []imageResult{},
		Skipped:  []int64{},
		Review:   []string{},
	}
	caption, media, isClip, err := w.snapshot(ctx, j)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if violation := contentpolicy.CheckObviousText(caption); violation != nil {
		var v *contentpolicy.Violation
		if errors.As(violation, &v) {
			out.Block = append(out.Block, v.Category)
		}
	}
	out.AuthorAdultRequired = contentpolicy.SensitiveLanguage(caption)
	out.AdultOnly = out.AuthorAdultRequired
	if isClip {
		out.Complete = true
		return out, nil
	}
	if strings.TrimSpace(caption) != "" {
		a, err := w.analyzer.Text(ctx, caption)
		if err != nil {
			return out, err
		}
		out.Text = &a
		textAdultOnly := a.Scores["profanity"] >= 0.9 || a.Scores["obscenity"] >= 0.9
		out.AuthorAdultRequired = out.AuthorAdultRequired || textAdultOnly
		out.AdultOnly = out.AdultOnly || textAdultOnly
		out.Block = append(out.Block, textBlockLabels(a)...)
		for _, label := range textReviewLabels(a) {
			if label == "insult" && a.Version != contentpolicy.SafetyVersion && contentpolicy.CheckObviousText(caption) == nil {
				continue
			}
			out.Review = append(out.Review, label)
		}
	}
	for _, m := range media {
		if strings.HasPrefix(m.MIME, "video/") {
			var frames []videoFrame
			var cached []byte
			version := ImageCacheVersion + ":" + VideoSamplingVersion
			e := w.db.QueryRowContext(ctx, `
				SELECT
				    result
				FROM post_analysis_media_cache
				WHERE media_id = $1
				    AND model_version = $2
			`, m.ID, version).Scan(&cached)
			if e == nil {
				e = json.Unmarshal(cached, &frames)
			} else if errors.Is(e, sql.ErrNoRows) {
				frames, e = w.analyzer.Video(ctx, m.Key, m.DurationMS)
				if e == nil {
					cached, _ = json.Marshal(frames)
					_, e = w.db.ExecContext(ctx, `
						INSERT INTO
						    post_analysis_media_cache (media_id, model_version, result)
						SELECT
						    id,
						    $2,
						    $3
						FROM media_assets
						WHERE id = $1
						ON CONFLICT DO NOTHING
					`, m.ID, version, cached)
				}
			}
			if e != nil {
				return out, e
			}
			if len(frames) != len(videoSampleTimes(m.DurationMS)) {
				return out, fmt.Errorf("incomplete video sampling")
			}
			out.Videos = append(out.Videos, videoResult{
				MediaID:     m.ID,
				Frames:      frames,
				SampledOnly: true,
			})
			for _, frame := range frames {
				out.Block = append(out.Block, imageBlockLabels(frame.Analysis)...)
				if isClip {
					out.Review = append(out.Review, sexualVisualReviewLabels(frame.Analysis)...)
				} else {
					out.Review = append(out.Review, visualReviewLabels(frame.Analysis)...)
				}
				out.AdultOnly = out.AdultOnly || visualAdultOnly(frame.Analysis)
			}
			continue
		}
		var data []byte
		var a Analysis
		err = w.db.QueryRowContext(ctx, `
			SELECT
			    result
			FROM post_analysis_media_cache
			WHERE media_id = $1
			    AND model_version = $2
		`, m.ID, ImageCacheVersion).Scan(&data)
		if err == nil {
			err = json.Unmarshal(data, &a)
		} else if errors.Is(err, sql.ErrNoRows) {
			a, err = w.analyzer.Image(ctx, m.Key)
			if err == nil && a.Version != ImageVersion {
				err = fmt.Errorf("unexpected image model version")
			}
			if err == nil {
				data, _ = json.Marshal(a)
				_, err = w.db.ExecContext(ctx, `
					INSERT INTO
					    post_analysis_media_cache (media_id, model_version, result)
					SELECT
					    id,
					    $2,
					    $3
					FROM media_assets
					WHERE id = $1
					ON CONFLICT DO NOTHING
				`, m.ID, ImageCacheVersion, data)
			}
		}
		if err != nil {
			return out, err
		}
		out.Images = append(out.Images, imageResult{
			MediaID:  m.ID,
			Analysis: a,
		})
		out.Block = append(out.Block, imageBlockLabels(a)...)
		if isClip {
			out.Review = append(out.Review, sexualVisualReviewLabels(a)...)
		} else {
			out.Review = append(out.Review, visualReviewLabels(a)...)
		}
		out.AdultOnly = out.AdultOnly || visualAdultOnly(a)
	}
	out.Review = unique(out.Review)
	out.Block = unique(out.Block)
	out.Complete = true
	return out, nil
}
func (w *Worker) finish(ctx context.Context, j job, out result, failure string) error {
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var postID int64
	err = tx.QueryRowContext(ctx, `
		SELECT
		    id
		FROM posts
		WHERE id = $1
		FOR UPDATE
	`, j.PostID).Scan(&postID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	state := "done"
	reason := ""
	if len(out.Review) > 0 {
		state = "review"
		reason = reviewReason(out.Review)
	}
	if len(out.Block) > 0 && out.Complete && failure == "" {
		state = "blocked"
		reason = "Автоматически снято с публикации: " + blockReason(out.Block) + " Модератор может пересмотреть решение."
	}
	if failure != "" {
		state = "failed"
		reason = "ИИ не смог завершить проверку публикации после повторных попыток. Нужна ручная проверка; безопасный результат не установлен."
	}
	data, _ := json.Marshal(out)
	changed, err := tx.ExecContext(ctx, `
		UPDATE post_analysis_jobs
		SET state = $4,
		    result = $5,
		    last_error = $6,
		    lease_until = NULL,
		    lease_token = NULL,
		    updated_at = now()
		WHERE post_id = $1
		    AND revision = $2
		    AND lease_token = $3
	`, j.PostID, j.Revision, j.Token, state, data, failure)
	if err != nil {
		return err
	}
	n, err := changed.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	if out.Complete && failure == "" {
		if _, err = tx.ExecContext(ctx, `
			UPDATE posts
			SET adult_only = $2,
			    age_classified = true
			WHERE id = $1
		`, j.PostID, out.AdultOnly); err != nil {
			return err
		}

		if out.AuthorAdultRequired {
			var adult bool
			if err = tx.QueryRowContext(ctx, `
				SELECT
				    content_age_visible (true, author_user_id)
				FROM posts
				WHERE id = $1
			`, j.PostID).Scan(&adult); err != nil {
				return err
			}
			if !adult {
				out.Block = unique(append(out.Block, "profanity_underage"))
				state = "blocked"
				reason = "Автоматически снято с публикации: " + blockReason(out.Block)
				data, _ = json.Marshal(out)
				if _, err = tx.ExecContext(ctx, `
					UPDATE post_analysis_jobs
					SET state = $2,
					    result = $3
					WHERE post_id = $1
				`, j.PostID, state, data); err != nil {
					return err
				}
			}
		}
	}

	if reason == "" {
		if _, err = tx.ExecContext(ctx, `
			UPDATE moderation_reports
			SET status = 'dismissed',
			    version = version + 1
			WHERE target_type = 'post'
			    AND target_id = $1
			    AND source = 'ai'
			    AND status = 'open'
		`, j.PostID); err != nil {
			return err
		}
	}
	if reason != "" {
		var reportID int64
		err = tx.QueryRowContext(ctx, `
			INSERT INTO
			    moderation_reports (target_type, target_id, reason, target_snapshot, source)
			SELECT
			    'post',
			    p.id,
			    $2,
			    jsonb_build_object(
			        'id',
			        p.id,
			        'author_user_id',
			        p.author_user_id,
			        'author_display_name',
			        author.display_name,
			        'author_username',
			        COALESCE(author.username, ''),
			        'caption',
			        p.caption,
			        'visibility',
			        p.visibility,
			        'city',
			        p.city,
			        'ai_analysis',
			        $3::jsonb,
			        'media_ids',
			        COALESCE(
			            (
			                SELECT
			                    jsonb_agg(
			                        media_id
			                        ORDER BY
			                            position
			                    )
			                FROM post_media
			                WHERE post_id = p.id
			            ),
			            '[]'::jsonb
			        )
			    ),
			    'ai'
			FROM posts p
			    JOIN users author ON author.id = p.author_user_id
			WHERE p.id = $1
			ON CONFLICT (target_type, target_id)
			WHERE source = 'ai'
			    AND status = 'open' DO UPDATE
			SET reason = EXCLUDED.reason,
			    target_snapshot = EXCLUDED.target_snapshot,
			    version = moderation_reports.version + 1
			RETURNING id
		`, j.PostID, reason, data).Scan(&reportID)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `
			DELETE FROM moderation_evidence_media
			WHERE report_id = $1
		`, reportID); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO
			    moderation_evidence_media (report_id, media_id)
			SELECT
			    $1,
			    media_id
			FROM post_media
			WHERE post_id = $2
		`, reportID, j.PostID); err != nil {
			return err
		}
	}
	if state == "blocked" {
		if err = w.hide(ctx, tx, j, out); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (w *Worker) fail(ctx context.Context, j job, cause error) error {

	message := cause.Error()
	if len(message) > 300 {
		message = message[:300]
	}
	if j.Attempt >= maxAttempts {
		return w.finish(ctx, j, result{
			Revision: j.Revision,
			Complete: false,
		}, message)
	}
	delay := time.Duration(1<<min(j.Attempt, 8)) * time.Second
	_, err := w.db.ExecContext(ctx, `
		UPDATE post_analysis_jobs
		SET state = 'pending',
		    run_at = now() + $4 * interval '1 second',
		    lease_until = NULL,
		    lease_token = NULL,
		    last_error = $5,
		    updated_at = now()
		WHERE post_id = $1
		    AND revision = $2
		    AND lease_token = $3
	`, j.PostID, j.Revision, j.Token, int(delay.Seconds()), message)
	return err
}

func textBlockLabels(a Analysis) []string {
	var labels []string
	if a.Version == contentpolicy.SafetyVersion {
		return unique(contentpolicy.SafetyBlockCategories(a.Scores))
	}
	if a.Version != TextVersion {
		return labels
	}
	for _, label := range a.Flags {
		if label == "sexual" {
			labels = append(labels, label)
		}
	}
	return labels
}
func textReviewLabels(a Analysis) []string {
	var labels []string
	for _, label := range reviewLabels(a) {
		if category := contentpolicy.SafetyCategory(label); category != "" {
			label = category
		}
		if label != "profanity" && label != "obscenity" && label != "obscene" {
			labels = append(labels, label)
		}
	}
	return labels
}

func imageBlockLabels(a Analysis) []string {
	if a.Version != ImageVersion {
		return nil
	}
	if a.Scores["sexual_explicit"] >= ExplicitBlockThreshold {
		return []string{"sexual_explicit"}
	}
	for _, flag := range a.Flags {
		if flag == "multiview_nudity" && ((a.Scores["sexual_explicit"] >= .75 && a.Scores["explicit_upper_crop"] >= .95) || (a.Scores["sexual_suggestive"] >= .8 && a.Scores["anatomy_female_breast_exposed"] >= .75 && a.Scores["explicit_center_crop"] >= .5)) {
			return []string{"anatomical_nudity"}
		}
		if flag == "anatomical_nudity" && (a.Scores["sexual_explicit"] >= 0.43724021315574646 || a.Scores["sexual_explicit_reference"] >= 0.43724021315574646) {
			return []string{"anatomical_nudity"}
		}
	}
	return nil
}

func visualAdultOnly(a Analysis) bool {
	return a.Version == ImageVersion && a.Scores["sexual_suggestive"] >= .8
}

func sexualVisualReviewLabels(a Analysis) []string {
	labels := make([]string, 0)
	for _, label := range visualReviewLabels(a) {
		if strings.HasPrefix(label, "sexual") || label == "anatomical_nudity" {
			labels = append(labels, label)
		}
	}
	return labels
}

func visualReviewLabels(a Analysis) []string {
	labels := make([]string, 0)
	for _, label := range reviewLabels(a) {
		if label != "violence" && label != "weapon" && label != "profanity" && label != "obscenity" && label != "obscene" {
			labels = append(labels, label)
		}
	}
	return labels
}
