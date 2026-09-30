package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type Publisher interface {
	Publish(int64, string, any)
}

type Worker struct {
	db          *sql.DB
	publisher   Publisher
	logger      *slog.Logger
	interval    time.Duration
	maxBotToken string
	botClient   *http.Client
}

type notificationJob struct {
	UserID      int64  `json:"user_id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Body        string `json:"body"`
	EventID     *int64 `json:"event_id"`
	PostID      *int64 `json:"post_id"`
	GiftID      *int64 `json:"gift_id"`
	GroupID     *int64 `json:"group_id"`
	ActorUserID *int64 `json:"actor_user_id"`
	DedupeKey   string `json:"dedupe_key"`
}

func NewWorker(db *sql.DB, publisher Publisher, logger *slog.Logger) *Worker {
	return &Worker{
		db:        db,
		publisher: publisher,
		logger:    logger,
		interval:  time.Second,
	}
}

func (w *Worker) WithBotDelivery(maxBotToken string) *Worker {
	w.maxBotToken = strings.TrimSpace(maxBotToken)
	if w.maxBotToken != "" {
		w.botClient = &http.Client{Timeout: 8 * time.Second}
	}
	return w
}

func (w *Worker) Run(ctx context.Context) {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		processed, err := w.runNext(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			w.logger.Error("background job failed", "error", err)
		}
		if processed && err == nil {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) RunBirthdayReminders(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		if err := w.enqueueBirthdayReminders(ctx); err != nil && !errors.Is(err, context.Canceled) {
			w.logger.Warn("birthday reminder enqueue failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) enqueueBirthdayReminders(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err := w.db.ExecContext(ctx, enqueueBirthdayRemindersSQL)
	if err != nil {
		return fmt.Errorf("enqueue birthday reminders: %w", err)
	}
	return nil
}

func (w *Worker) runNext(ctx context.Context) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var jobID int64
	var payloadJSON []byte
	var attempt int
	err := w.db.QueryRowContext(ctx, `
		WITH
		    next AS (
		        SELECT
		            id
		        FROM background_jobs
		        WHERE finished_at IS NULL
		            AND attempts < 5
		            AND run_at <= now()
		            AND (
		                locked_at IS NULL
		                OR locked_at < now() - interval '5 minutes'
		            )
		        ORDER BY
		            run_at,
		            id
		        LIMIT 1
		        FOR UPDATE
		            SKIP LOCKED
		    )
		UPDATE background_jobs job
		SET locked_at = now(),
		    attempts = attempts + 1
		FROM next
		WHERE job.id = next.id
		RETURNING job.id,
		    job.payload,
		    job.attempts
	`).Scan(&jobID, &payloadJSON, &attempt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim background job: %w", err)
	}
	err = w.processJob(ctx, jobID, attempt, payloadJSON)
	if err != nil {
		retry, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer stop()
		if failure := w.recordFailure(retry, jobID, attempt, err); failure != nil {
			return true, errors.Join(err, failure)
		}
	}
	return true, err
}

func (w *Worker) processJob(ctx context.Context, jobID int64, attempt int, payloadJSON []byte) error {
	tx, err := w.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin background job: %w", err)
	}
	defer tx.Rollback()
	var id int64
	err = tx.QueryRowContext(ctx, `
		SELECT
		    id
		FROM background_jobs
		WHERE id = $1
		    AND attempts = $2
		    AND finished_at IS NULL
		FOR UPDATE
	`, jobID, attempt).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	var payload notificationJob
	if err := json.Unmarshal(payloadJSON, &payload); err != nil || payload.UserID <= 0 || payload.Kind == "" ||
		payload.Title == "" || payload.Body == "" || payload.DedupeKey == "" ||
		utf8.RuneCountInString(payload.Kind) > 64 || utf8.RuneCountInString(payload.Title) > 120 ||
		utf8.RuneCountInString(payload.Body) > 500 || utf8.RuneCountInString(payload.DedupeKey) > 200 ||
		(payload.EventID != nil && *payload.EventID <= 0) ||
		(payload.PostID != nil && *payload.PostID <= 0) ||
		(payload.GiftID != nil && *payload.GiftID <= 0) ||
		(payload.GroupID != nil && *payload.GroupID <= 0) ||
		(payload.ActorUserID != nil && *payload.ActorUserID <= 0) {
		if _, updateErr := tx.ExecContext(ctx, `
			UPDATE background_jobs
			SET finished_at = now(),
			    locked_at = NULL,
			    last_error = 'invalid notification payload'
			WHERE id = $1
		`, jobID); updateErr != nil {
			return fmt.Errorf("reject invalid background job: %w", updateErr)
		}
		return tx.Commit()
	}

	var eligible bool
	if err := tx.QueryRowContext(ctx, sendJobSQL, payload.UserID, payload.EventID, payload.PostID, payload.GiftID, payload.GroupID, payload.ActorUserID, payload.Kind).Scan(&eligible); err != nil {
		return fmt.Errorf("check notification eligibility: %w", err)
	}
	if !eligible {
		if _, err := tx.ExecContext(ctx, `
			UPDATE background_jobs
			SET finished_at = now(),
			    locked_at = NULL,
			    last_error = ''
			WHERE id = $1
		`, jobID); err != nil {
			return fmt.Errorf("finish obsolete notification: %w", err)
		}
		return tx.Commit()
	}

	var notification Notification
	err = tx.QueryRowContext(ctx, `
		INSERT INTO
		    notifications (
		        user_id,
		        kind,
		        title,
		        body,
		        event_id,
		        post_id,
		        gift_id,
		        group_id,
		        actor_user_id,
		        dedupe_key
		    )
		VALUES
		    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (user_id, dedupe_key) DO UPDATE
		SET dedupe_key = EXCLUDED.dedupe_key
		RETURNING id,
		    kind,
		    title,
		    body,
		    event_id,
		    post_id,
		    gift_id,
		    group_id,
		    actor_user_id,
		    read_at,
		    created_at
	`,
		payload.UserID, payload.Kind, payload.Title, payload.Body,
		payload.EventID, payload.PostID, payload.GiftID, payload.GroupID, payload.ActorUserID, payload.DedupeKey,
	).Scan(
		&notification.ID, &notification.Kind, &notification.Title, &notification.Body,
		&notification.EventID, &notification.PostID, &notification.GiftID, &notification.GroupID, &notification.ActorUserID,
		&notification.ReadAt, &notification.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("create notification: %w", err)
	}
	if err := queueBotDelivery(ctx, tx, notification.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE background_jobs
		SET finished_at = now(),
		    locked_at = NULL,
		    last_error = ''
		WHERE id = $1
	`, jobID); err != nil {
		return fmt.Errorf("finish background job: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit background job: %w", err)
	}
	if w.publisher != nil {
		w.publisher.Publish(payload.UserID, "notification.created", notification)
	}
	return nil
}

func (w *Worker) recordFailure(ctx context.Context, jobID int64, attempt int, jobErr error) error {
	message := jobErr.Error()
	if utf8.RuneCountInString(message) > 1000 {
		message = string([]rune(message)[:1000])
	}
	_, err := w.db.ExecContext(ctx, `
		UPDATE background_jobs
		SET locked_at = NULL,
		    last_error = $2,
		    run_at = now() + LEAST(power(2, GREATEST(attempts - 1, 0)) * 10, 300) * interval '1 second',
		    finished_at = CASE
		        WHEN attempts >= 5 THEN now()
		        ELSE NULL
		    END
		WHERE id = $1
		    AND attempts = $3
		    AND finished_at IS NULL
	`, jobID, message, attempt)
	if err != nil {
		return fmt.Errorf("update failed background job: %w", err)
	}
	return nil
}
