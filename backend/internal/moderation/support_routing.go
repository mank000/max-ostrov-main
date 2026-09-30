package moderation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

type SupportDelivery struct {
	ID          int64
	ThreadID    int64
	RecipientID int64
	Kind        string
	Body        string
	PhotoToken  string
}

func (d SupportDelivery) Text() string {
	if d.Kind == "request" {
		return fmt.Sprintf("Новое обращение #%d:\n%s\n\nОтвет: /reply %d <текст>", d.ThreadID, d.Body, d.ThreadID)
	}
	return fmt.Sprintf("Сообщение по обращению #%d:\n%s\n\nОтвет: /reply %d <текст>", d.ThreadID, d.Body, d.ThreadID)
}

func (s *Service) ClaimSupportDelivery(ctx context.Context) (SupportDelivery, error) {
	var item SupportDelivery
	var photo sql.NullString
	err := s.db.QueryRowContext(ctx, `WITH next AS (
		SELECT id FROM support_bot_deliveries
		WHERE sent_at IS NULL AND attempts < 10
			AND (claimed_at IS NULL OR claimed_at < now()-interval '2 minutes')
		ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
	), claimed AS (
		UPDATE support_bot_deliveries delivery SET claimed_at=now(),attempts=attempts+1
		FROM next WHERE delivery.id=next.id
		RETURNING delivery.id,delivery.thread_id,delivery.message_id,delivery.recipient_provider_id,delivery.kind
	)
	SELECT claimed.id,claimed.thread_id,claimed.recipient_provider_id,claimed.kind,message.body,message.photo_token
	FROM claimed JOIN support_messages message ON message.id=claimed.message_id`).
		Scan(&item.ID, &item.ThreadID, &item.RecipientID, &item.Kind, &item.Body, &photo)
	if err != nil {
		return SupportDelivery{}, err
	}
	if photo.Valid {
		item.PhotoToken = photo.String
	}
	return item, nil
}

func (s *Service) MarkSupportDelivery(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `UPDATE support_bot_deliveries SET sent_at=now() WHERE id=$1 AND sent_at IS NULL`, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) SupportOwnerPrincipal(ctx context.Context, maxID int64) (Principal, error) {
	var principal Principal
	err := s.db.QueryRowContext(ctx, `SELECT account.id FROM users account
		JOIN user_identities identity ON identity.user_id=account.id
		WHERE identity.provider='max' AND identity.provider_user_id=$1
			AND identity.status='verified' AND account.moderation_suspended_at IS NULL`, maxID).Scan(&principal.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return Principal{}, ErrForbidden
	}
	if err != nil {
		return Principal{}, err
	}
	principal.Role = "support_owner"
	principal.SupportOwner = true
	return principal, nil
}

func (s *Service) SetSupportVerification(ctx context.Context, threadID int64, principal Principal, action, reason string) error {
	reason = strings.TrimSpace(reason)
	if threadID <= 0 || principal.UserID <= 0 || (principal.Role != "moderator" && principal.Role != "administrator" && !principal.SupportOwner) ||
		(action != "full" && action != "age" && action != "none") || utf8.RuneCountInString(reason) < 8 || utf8.RuneCountInString(reason) > 500 {
		return ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var subjectID int64
	var ageVerified sql.NullTime
	var avatarID sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT account.id,account.face_verified_at,account.avatar_media_id
		FROM support_threads thread
		JOIN user_identities identity ON identity.provider='max' AND identity.provider_user_id=thread.provider_user_id AND identity.status='verified'
		JOIN users account ON account.id=identity.user_id
		WHERE thread.id=$1 AND thread.status='open' FOR UPDATE OF account`, threadID).
		Scan(&subjectID, &ageVerified, &avatarID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if (action != "none" && !ageVerified.Valid) || (action == "full" && !avatarID.Valid) {
		return ErrConflict
	}
	var verifiedAvatar sql.NullInt64
	if action == "full" {
		verifiedAvatar = avatarID
	}
	if _, err = tx.ExecContext(ctx, `UPDATE users SET face_avatar_verified_media_id=$2,
		face_verified_at=CASE WHEN $3='none' THEN NULL ELSE face_verified_at END,
		updated_at=now() WHERE id=$1`, subjectID, verifiedAvatar, action); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO support_verification_actions(thread_id,subject_user_id,actor_user_id,action,reason)
		VALUES($1,$2,$3,$4,$5)`, threadID, subjectID, principal.UserID, action, reason); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if s.publisher != nil {
		s.publisher.Publish(subjectID, "profile.verification_updated", map[string]any{"verification_tier": action})
	}
	return nil
}
