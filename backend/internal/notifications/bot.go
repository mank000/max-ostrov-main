package notifications

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type deliveryDB interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func EnqueueBotDelivery(ctx context.Context, tx *sql.Tx, notificationID int64) error {
	return queueBotDelivery(ctx, tx, notificationID)
}

func queueBotDelivery(ctx context.Context, db deliveryDB, notificationID int64) error {
	if _, err := db.ExecContext(ctx, `
		INSERT INTO notification_bot_deliveries (
			notification_id, provider, provider_user_id
		)
		SELECT notification.id, identity.provider, identity.provider_user_id
		FROM notifications notification
		JOIN user_identities identity
			ON identity.user_id = notification.user_id
			AND identity.status = 'verified'
		WHERE notification.kind IN (
				'friend_request',
				'friend_request_accepted',
				'friend_birthday',
				'gift_received',
				'post_comment',
				'post_like',
				'comment_like',
				'dating_like',
				'dating_match',
				'group_invitation',
				'event_invitation',
				'event_reminder'
			)
			AND notification.read_at IS NULL
			AND notification.id = $1
			AND `+notificationModerationVisibilitySQL+`
			AND (
				identity.provider = 'max'
			)
		ON CONFLICT DO NOTHING`, notificationID); err != nil {
		return fmt.Errorf("queue bot notification deliveries: %w", err)
	}

	return nil
}

func (w *Worker) RunBotDelivery(ctx context.Context) {
	if w.botClient == nil {
		return
	}
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		processed, err := w.runNextBotDelivery(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			w.logger.Warn("bot notification delivery failed", "error", err)
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

func (w *Worker) runNextBotDelivery(ctx context.Context) (bool, error) {
	if w.botClient == nil {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	var notification Notification
	var providerUserID int64
	var provider string
	var attempt int
	var canSend bool

	err := w.db.QueryRowContext(ctx, `
		WITH next AS (
			SELECT notification_id, provider, provider_user_id
			FROM notification_bot_deliveries
			WHERE delivered_at IS NULL AND attempts < 5
				AND next_attempt_at <= now() AND provider = 'max'
			ORDER BY next_attempt_at, notification_id
			LIMIT 1 FOR UPDATE SKIP LOCKED
		), claimed AS (
			UPDATE notification_bot_deliveries delivery
			SET attempts = attempts + 1, next_attempt_at = now() + interval '1 minute'
			FROM next
			WHERE delivery.notification_id = next.notification_id
				AND delivery.provider = next.provider
				AND delivery.provider_user_id = next.provider_user_id
			RETURNING delivery.*
		)
		SELECT notification.id, notification.kind, notification.title, notification.body,
			notification.actor_user_id, claimed.provider, claimed.provider_user_id, claimed.attempts,
			notification.read_at IS NULL AND `+notificationModerationVisibilitySQL+`
			AND NOT EXISTS (SELECT 1 FROM user_blocks block
				WHERE (block.blocker_id = notification.user_id AND block.blocked_id = notification.actor_user_id)
					OR (block.blocker_id = notification.actor_user_id AND block.blocked_id = notification.user_id))
			AND (notification.kind <> 'friend_birthday' OR EXISTS (
				SELECT 1 FROM users birthday_friend
				JOIN friendships friendship
					ON friendship.user_low_id = LEAST(notification.user_id, birthday_friend.id)
					AND friendship.user_high_id = GREATEST(notification.user_id, birthday_friend.id)
				WHERE birthday_friend.id = notification.actor_user_id
					AND birthday_friend.show_birth_date
					AND birthday_friend.birth_date IS NOT NULL
					AND extract(month FROM birthday_friend.birth_date) = extract(month FROM current_date)
					AND extract(day FROM birthday_friend.birth_date) = extract(day FROM current_date)
			))
		FROM claimed JOIN notifications notification ON notification.id = claimed.notification_id
	`).Scan(&notification.ID, &notification.Kind, &notification.Title, &notification.Body,
		&notification.ActorUserID, &provider, &providerUserID, &attempt, &canSend)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim bot notification: %w", err)
	}

	var sendErr error
	if canSend {
		sendErr = w.sendMAXNotification(ctx, providerUserID, w.botNotificationText(ctx, notification))
	}

	if sendErr == nil {
		if _, err := w.db.ExecContext(ctx, `
			UPDATE notification_bot_deliveries
			SET delivered_at = now(),
				last_error = ''
			WHERE notification_id = $1 AND provider = $2 AND provider_user_id = $3
				AND attempts = $4 AND delivered_at IS NULL`,
			notification.ID, provider, providerUserID, attempt,
		); err != nil {
			return true, fmt.Errorf("finish bot notification delivery: %w", err)
		}
		return true, nil
	}

	lastError := sendErr.Error()
	if utf8.RuneCountInString(lastError) > 500 {
		lastError = string([]rune(lastError)[:500])
	}
	if _, err := w.db.ExecContext(ctx, `
		UPDATE notification_bot_deliveries
		SET next_attempt_at = now() + LEAST(attempts, 5) * interval '1 minute',
			last_error = $4
		WHERE notification_id = $1 AND provider = $2 AND provider_user_id = $3
			AND attempts = $5 AND delivered_at IS NULL`,
		notification.ID, provider, providerUserID, lastError, attempt,
	); err != nil {
		return true, fmt.Errorf("record bot notification delivery failure: %w", err)
	}
	return true, sendErr
}

func (w *Worker) botNotificationText(ctx context.Context, notification Notification) string {
	icon := "🔔"
	switch notification.Kind {
	case "friend_request", "friend_request_accepted":
		icon = "👋"
	case "friend_birthday":
		icon = "🎂"
	case "gift_received":
		icon = "🎁"
	case "post_comment":
		icon = "💬"
	case "post_like", "comment_like":
		icon = "❤️"
	case "group_invitation":
		icon = "👥"
	case "event_reminder":
		icon = "📅"
	}
	lines := []string{icon + " " + notification.Title}
	if notification.ActorUserID != nil {
		var actorName string
		if err := w.db.QueryRowContext(ctx, "SELECT display_name FROM users WHERE id = $1", *notification.ActorUserID).Scan(&actorName); err == nil && strings.TrimSpace(actorName) != "" {
			lines = append(lines, actorName)
		}
	}
	if strings.TrimSpace(notification.Body) != "" {
		lines = append(lines, notification.Body)
	}
	return strings.Join(lines, "\n")
}

func (w *Worker) sendMAXNotification(ctx context.Context, userID int64, message string) error {
	endpoint := fmt.Sprintf("https://platform-api2.max.ru/messages?user_id=%d", userID)
	return w.postBotJSON(ctx, endpoint, w.maxBotToken, map[string]any{
		"text":   message,
		"notify": true,
	})
}

func (w *Worker) postBotJSON(ctx context.Context, endpoint, authorization string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode bot notification: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("build bot notification request")
	}
	request.Header.Set("Content-Type", "application/json")
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	response, err := w.botClient.Do(request)
	if err != nil {
		return errors.New("bot notification transport failed")
	}
	defer func() { _ = response.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("bot API returned HTTP %d", response.StatusCode)
	}
	return nil
}
