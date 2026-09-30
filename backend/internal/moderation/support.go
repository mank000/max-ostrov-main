package moderation

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrSupportLimit = errors.New("support message limit reached")

type SupportThread struct {
	ID             int64
	ProviderUserID int64
	Status         string
	UpdatedAt      time.Time
}

type SupportMessage struct {
	Sender string
	Body   string
}

type SupportSubmission struct {
	OwnerMAXID int64
	PhotoToken string
}

func validSupportBody(body string) bool {
	return body != "" && utf8.RuneCountInString(body) <= 2000
}

// SubmitSupport keeps one conversation per bot chat and ignores retried provider updates.
func (s *Service) SubmitSupport(ctx context.Context, providerID int64, messageID, body string, options ...SupportSubmission) (int64, bool, error) {
	body = strings.TrimSpace(body)
	if providerID <= 0 || messageID == "" || !validSupportBody(body) {
		return 0, false, ErrInvalid
	}
	var route SupportSubmission
	if len(options) > 0 {
		route = options[0]
	}
	if route.PhotoToken != "" && (len(route.PhotoToken) > 2048 || strings.ContainsAny(route.PhotoToken, " \t\r\n\x00")) {
		return 0, false, ErrInvalid
	}
	var photoToken sql.NullString
	if route.PhotoToken != "" {
		photoToken = sql.NullString{String: route.PhotoToken, Valid: true}
	}
	var selectedStaff int64
	var eligibleStaff []int64
	if len(options) > 0 {
		staff, err := s.SupportStaff(ctx, "max")
		if err != nil {
			return 0, false, err
		}
		eligibleStaff = make([]int64, 0, len(staff))
		for _, id := range staff {
			if id != providerID && id != route.OwnerMAXID {
				eligibleStaff = append(eligibleStaff, id)
			}
		}
		if len(eligibleStaff) > 0 {
			index, err := rand.Int(rand.Reader, big.NewInt(int64(len(eligibleStaff))))
			if err != nil {
				return 0, false, err
			}
			selectedStaff = eligibleStaff[index.Int64()]
		}
		if selectedStaff == 0 && (route.OwnerMAXID <= 0 || route.OwnerMAXID == providerID) {
			return 0, false, ErrUnavailable
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, false, err
	}
	defer tx.Rollback()
	var id int64
	_, err = tx.ExecContext(ctx, `INSERT INTO support_threads (provider_user_id) VALUES ($1)
		ON CONFLICT (provider_user_id) DO NOTHING`, providerID)
	if err != nil {
		return 0, false, err
	}
	var assigned sql.NullInt64
	var priorStatus string
	err = tx.QueryRowContext(ctx, `SELECT id,assigned_staff_provider_id,status FROM support_threads WHERE provider_user_id=$1 FOR UPDATE`, providerID).Scan(&id, &assigned, &priorStatus)
	if err != nil {
		return 0, false, err
	}
	var duplicate bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM support_messages WHERE thread_id=$1 AND platform_message_id=$2)`, id, messageID).Scan(&duplicate)
	if err != nil {
		return 0, false, err
	}
	if duplicate {
		if err = tx.Commit(); err != nil {
			return 0, false, err
		}
		return id, false, nil
	}
	var recent int
	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM support_messages
		WHERE thread_id=$1 AND sender='user' AND created_at > now()-interval '1 minute'`, id).Scan(&recent)
	if err != nil {
		return 0, false, err
	}
	if recent >= 5 {
		return 0, false, ErrSupportLimit
	}
	var inserted int64
	err = tx.QueryRowContext(ctx, `INSERT INTO support_messages (thread_id,sender,sender_provider_id,body,platform_message_id,photo_token)
		VALUES ($1,'user',$2,$3,$4,$5) ON CONFLICT (thread_id,platform_message_id) DO NOTHING RETURNING id`, id, providerID, body, messageID, photoToken).Scan(&inserted)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, false, err
	}
	assignedActive := false
	for _, id := range eligibleStaff {
		if assigned.Valid && assigned.Int64 == id {
			assignedActive = true
			break
		}
	}
	if len(options) > 0 && !assignedActive {
		assigned = sql.NullInt64{}
	}
	if !assigned.Valid && selectedStaff > 0 {
		assigned = sql.NullInt64{Int64: selectedStaff, Valid: true}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE support_threads SET status='open',updated_at=now(),assigned_staff_provider_id=$2 WHERE id=$1`, id, assigned); err != nil {
		return 0, false, err
	}
	if inserted > 0 && len(options) > 0 {
		kind := "user_message"
		if priorStatus != "open" || recent == 0 {
			kind = "request"
		}
		for _, recipient := range []int64{assigned.Int64, route.OwnerMAXID} {
			if recipient <= 0 || recipient == providerID {
				continue
			}
			if _, err = tx.ExecContext(ctx, `INSERT INTO support_bot_deliveries(thread_id,message_id,recipient_provider_id,kind)
				VALUES($1,$2,$3,$4) ON CONFLICT (message_id,recipient_provider_id) DO NOTHING`, id, inserted, recipient, kind); err != nil {
				return 0, false, err
			}
		}
	}
	if err = tx.Commit(); err != nil {
		return 0, false, err
	}
	return id, inserted > 0, nil
}

func (s *Service) SupportStaff(ctx context.Context, provider string) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT identity.provider_user_id FROM user_identities identity
		JOIN users account ON account.id=identity.user_id
		JOIN user_roles role ON role.user_id=identity.user_id
		WHERE identity.provider=$1 AND identity.status='verified' AND account.moderation_suspended_at IS NULL
		AND role.role IN ('moderator','administrator')`, provider)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Service) SupportInbox(ctx context.Context) ([]SupportThread, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,provider_user_id,status,updated_at FROM support_threads
		WHERE status='open' ORDER BY updated_at DESC LIMIT 10`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var threads []SupportThread
	for rows.Next() {
		var item SupportThread
		if err = rows.Scan(&item.ID, &item.ProviderUserID, &item.Status, &item.UpdatedAt); err != nil {
			return nil, err
		}
		threads = append(threads, item)
	}
	return threads, rows.Err()
}

func (s *Service) SupportHistory(ctx context.Context, id int64) (SupportThread, []SupportMessage, error) {
	var thread SupportThread
	err := s.db.QueryRowContext(ctx, `SELECT id,provider_user_id,status,updated_at FROM support_threads WHERE id=$1`, id).
		Scan(&thread.ID, &thread.ProviderUserID, &thread.Status, &thread.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return thread, nil, ErrNotFound
	}
	if err != nil {
		return thread, nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sender,body FROM
		(SELECT id,sender,body FROM support_messages
		 WHERE thread_id=$1 AND (sender='user' OR delivered_at IS NOT NULL)
		 ORDER BY id DESC LIMIT 10) recent ORDER BY id`, id)
	if err != nil {
		return thread, nil, err
	}
	defer rows.Close()
	var messages []SupportMessage
	for rows.Next() {
		var item SupportMessage
		if err = rows.Scan(&item.Sender, &item.Body); err != nil {
			return thread, nil, err
		}
		messages = append(messages, item)
	}
	return thread, messages, rows.Err()
}

func (s *Service) ReplySupport(ctx context.Context, id, staffID int64, operationID, body string, send func(context.Context, int64, string) error) error {
	return s.replySupport(ctx, id, staffID, operationID, body, "", func(ctx context.Context, recipient int64, message, _ string) error {
		return send(ctx, recipient, message)
	})
}

func (s *Service) ReplySupportMedia(ctx context.Context, id, staffID int64, operationID, body, photoToken string, send func(context.Context, int64, string, string) error) error {
	return s.replySupport(ctx, id, staffID, operationID, body, photoToken, send)
}

func (s *Service) replySupport(ctx context.Context, id, staffID int64, operationID, body, photoToken string, send func(context.Context, int64, string, string) error) error {
	body = strings.TrimSpace(body)
	operationID = strings.TrimSpace(operationID)
	if id <= 0 || staffID <= 0 || operationID == "" || len(operationID) > 200 || !validSupportBody(body) ||
		(photoToken != "" && (len(photoToken) > 2048 || strings.ContainsAny(photoToken, " \t\r\n\x00"))) {
		return ErrInvalid
	}
	var photo sql.NullString
	if photoToken != "" {
		photo = sql.NullString{String: photoToken, Valid: true}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var recipient int64
	err = tx.QueryRowContext(ctx, `SELECT provider_user_id FROM support_threads WHERE id=$1 AND status='open' FOR UPDATE`, id).Scan(&recipient)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var messageID int64
	err = tx.QueryRowContext(ctx, `INSERT INTO support_messages (thread_id,sender,sender_provider_id,body,platform_message_id,photo_token)
		VALUES ($1,'staff',$2,$3,$4,$5) ON CONFLICT (thread_id,platform_message_id) DO NOTHING RETURNING id`,
		id, staffID, body, operationID, photo).Scan(&messageID)
	if errors.Is(err, sql.ErrNoRows) {
		var delivered sql.NullTime
		if err = tx.QueryRowContext(ctx, `SELECT delivered_at FROM support_messages
			WHERE thread_id=$1 AND platform_message_id=$2 AND sender='staff'`, id, operationID).Scan(&delivered); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		if delivered.Valid {
			return nil
		}
		return ErrConflict
	}
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if err = send(ctx, recipient, "Поддержка Кутёжа (#"+fmt.Sprint(id)+"):\n"+body, photoToken); err != nil {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		_, _ = s.db.ExecContext(cleanup, `DELETE FROM support_messages WHERE id=$1 AND delivered_at IS NULL`, messageID)
		return err
	}
	confirm, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	if _, err = s.db.ExecContext(confirm, `UPDATE support_messages SET delivered_at=now() WHERE id=$1`, messageID); err != nil {
		return err
	}
	return nil
}

func (s *Service) CloseSupport(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, `UPDATE support_threads SET status='closed',updated_at=now() WHERE id=$1 AND status='open'`, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}
