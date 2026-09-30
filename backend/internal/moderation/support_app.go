package moderation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"kutezh/backend/internal/media"
)

type SupportAttachment struct {
	ID         int64  `json:"id"`
	MIMEType   string `json:"mime_type"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMS int    `json:"duration_ms"`
	URL        string `json:"url"`
}

type SupportChatMessage struct {
	ID        int64               `json:"id"`
	Sender    string              `json:"sender"`
	Body      string              `json:"body"`
	CreatedAt time.Time           `json:"created_at"`
	Media     []SupportAttachment `json:"media"`
}

type SupportChatUser struct {
	ID             int64  `json:"id"`
	ProviderUserID int64  `json:"provider_user_id"`
	DisplayName    string `json:"display_name"`
	Username       string `json:"username"`
}

type SupportChat struct {
	ID        int64                `json:"id"`
	Status    string               `json:"status"`
	UpdatedAt time.Time            `json:"updated_at"`
	User      *SupportChatUser     `json:"user,omitempty"`
	Messages  []SupportChatMessage `json:"messages"`
}

type SupportQueueItem struct {
	ID             int64      `json:"id"`
	ProviderUserID int64      `json:"provider_user_id"`
	UserID         int64      `json:"user_id"`
	DisplayName    string     `json:"display_name"`
	Username       string     `json:"username"`
	Status         string     `json:"status"`
	UpdatedAt      time.Time  `json:"updated_at"`
	LatestBody     string     `json:"latest_body"`
	LatestSender   string     `json:"latest_sender"`
	LatestAt       *time.Time `json:"latest_at,omitempty"`
}

func validAppSupportMessage(body string, mediaIDs []int64) bool {
	return (body != "" || len(mediaIDs) > 0) &&
		utf8.RuneCountInString(body) <= 2000 &&
		len(mediaIDs) <= 4
}

func supportMediaAllowed(mimeType string) bool {
	switch mimeType {
	case "image/jpeg", "image/png", "video/mp4", "video/quicktime":
		return true
	default:
		return false
	}
}

func (s *Service) supportProviderID(ctx context.Context, userID int64) (int64, error) {
	var providerID int64
	err := s.db.QueryRowContext(ctx, `SELECT provider_user_id FROM user_identities
		WHERE user_id=$1 AND provider='max' AND status='verified' LIMIT 1`, userID).Scan(&providerID)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	return providerID, nil
}

func (s *Service) UserSupportChat(ctx context.Context, userID int64) (SupportChat, error) {
	providerID, err := s.supportProviderID(ctx, userID)
	if err != nil {
		return SupportChat{}, err
	}
	chat := SupportChat{Status: "new", Messages: []SupportChatMessage{}}
	err = s.db.QueryRowContext(ctx, `SELECT id,status,updated_at FROM support_threads
		WHERE provider_user_id=$1`, providerID).Scan(&chat.ID, &chat.Status, &chat.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return chat, nil
	}
	if err != nil {
		return SupportChat{}, err
	}
	chat.Messages, err = s.supportChatMessages(ctx, chat.ID)
	return chat, err
}

func (s *Service) SupportQueue(ctx context.Context, status string) ([]SupportQueueItem, error) {
	status = strings.TrimSpace(status)
	if status == "" {
		status = "open"
	}
	if status != "open" && status != "closed" && status != "all" {
		return nil, ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT thread.id,thread.provider_user_id,thread.status,thread.updated_at,
			COALESCE(account.id,0),COALESCE(account.display_name,''),COALESCE(account.username,''),
			COALESCE(last_message.body,''),COALESCE(last_message.sender,''),last_message.created_at
		FROM support_threads thread
		LEFT JOIN user_identities identity ON identity.provider='max'
			AND identity.provider_user_id=thread.provider_user_id AND identity.status='verified'
		LEFT JOIN users account ON account.id=identity.user_id
		LEFT JOIN LATERAL (
			SELECT body,sender,created_at FROM support_messages
			WHERE thread_id=thread.id ORDER BY id DESC LIMIT 1
		) last_message ON true
		WHERE ($1='all' OR thread.status=$1)
		ORDER BY thread.updated_at DESC LIMIT 100`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]SupportQueueItem, 0)
	for rows.Next() {
		var item SupportQueueItem
		var latest sql.NullTime
		if err := rows.Scan(
			&item.ID, &item.ProviderUserID, &item.Status, &item.UpdatedAt,
			&item.UserID, &item.DisplayName, &item.Username,
			&item.LatestBody, &item.LatestSender, &latest,
		); err != nil {
			return nil, err
		}
		if latest.Valid {
			value := latest.Time
			item.LatestAt = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) SupportChatForStaff(ctx context.Context, threadID int64) (SupportChat, error) {
	if threadID <= 0 {
		return SupportChat{}, ErrNotFound
	}
	var chat SupportChat
	var user SupportChatUser
	err := s.db.QueryRowContext(ctx, `
		SELECT thread.id,thread.status,thread.updated_at,thread.provider_user_id,
			COALESCE(account.id,0),COALESCE(account.display_name,''),COALESCE(account.username,'')
		FROM support_threads thread
		LEFT JOIN user_identities identity ON identity.provider='max'
			AND identity.provider_user_id=thread.provider_user_id AND identity.status='verified'
		LEFT JOIN users account ON account.id=identity.user_id
		WHERE thread.id=$1`, threadID).
		Scan(&chat.ID, &chat.Status, &chat.UpdatedAt, &user.ProviderUserID, &user.ID, &user.DisplayName, &user.Username)
	if errors.Is(err, sql.ErrNoRows) {
		return SupportChat{}, ErrNotFound
	}
	if err != nil {
		return SupportChat{}, err
	}
	chat.User = &user
	chat.Messages, err = s.supportChatMessages(ctx, threadID)
	return chat, err
}

func (s *Service) supportChatMessages(ctx context.Context, threadID int64) ([]SupportChatMessage, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id,sender,body,created_at FROM (
			SELECT id,sender,body,created_at FROM support_messages
			WHERE thread_id=$1 ORDER BY id DESC LIMIT 300
		) recent ORDER BY id`, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	messages := make([]SupportChatMessage, 0)
	byID := make(map[int64]int)
	for rows.Next() {
		var item SupportChatMessage
		item.Media = []SupportAttachment{}
		if err := rows.Scan(&item.ID, &item.Sender, &item.Body, &item.CreatedAt); err != nil {
			return nil, err
		}
		byID[item.ID] = len(messages)
		messages = append(messages, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	mediaRows, err := s.db.QueryContext(ctx, `
		SELECT link.message_id,asset.id,asset.mime_type,asset.width,asset.height,asset.duration_ms
		FROM support_message_media link
		JOIN support_messages message ON message.id=link.message_id
		JOIN media_assets asset ON asset.id=link.media_id
		WHERE message.thread_id=$1 ORDER BY message.id,link.position`, threadID)
	if err != nil {
		return nil, err
	}
	defer mediaRows.Close()
	for mediaRows.Next() {
		var messageID int64
		var item SupportAttachment
		if err := mediaRows.Scan(
			&messageID, &item.ID, &item.MIMEType, &item.Width, &item.Height, &item.DurationMS,
		); err != nil {
			return nil, err
		}
		item.URL = "/api/v1/media/" + fmt.Sprint(item.ID) + "/content"
		if index, ok := byID[messageID]; ok {
			messages[index].Media = append(messages[index].Media, item)
		}
	}
	return messages, mediaRows.Err()
}

func (s *Service) SubmitSupportApp(
	ctx context.Context,
	userID int64,
	body string,
	mediaIDs []int64,
) (SupportChatMessage, error) {
	body = strings.TrimSpace(body)
	if userID <= 0 || !validAppSupportMessage(body, mediaIDs) {
		return SupportChatMessage{}, ErrInvalid
	}
	providerID, err := s.supportProviderID(ctx, userID)
	if err != nil {
		return SupportChatMessage{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SupportChatMessage{}, err
	}
	defer tx.Rollback()

	if _, err = tx.ExecContext(ctx, `INSERT INTO support_threads(provider_user_id) VALUES($1)
		ON CONFLICT(provider_user_id) DO NOTHING`, providerID); err != nil {
		return SupportChatMessage{}, err
	}
	var threadID int64
	var status string
	var assigned sql.NullInt64
	if err = tx.QueryRowContext(ctx, `SELECT id,status,assigned_staff_provider_id
		FROM support_threads WHERE provider_user_id=$1 FOR UPDATE`, providerID).
		Scan(&threadID, &status, &assigned); err != nil {
		return SupportChatMessage{}, err
	}
	var recent int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM support_messages
		WHERE thread_id=$1 AND sender='user' AND created_at>now()-interval '1 minute'`, threadID).
		Scan(&recent); err != nil {
		return SupportChatMessage{}, err
	}
	if recent >= 5 {
		return SupportChatMessage{}, ErrSupportLimit
	}

	if !assigned.Valid {
		var staffID int64
		err = tx.QueryRowContext(ctx, `SELECT identity.provider_user_id
			FROM user_identities identity
			JOIN users account ON account.id=identity.user_id
			JOIN user_roles role ON role.user_id=identity.user_id
			WHERE identity.provider='max' AND identity.status='verified'
				AND account.moderation_suspended_at IS NULL
				AND role.role IN ('moderator','administrator')
				AND identity.provider_user_id<>$1
			ORDER BY CASE WHEN role.role='administrator' THEN 0 ELSE 1 END,identity.provider_user_id
			LIMIT 1`, providerID).Scan(&staffID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return SupportChatMessage{}, err
		}
		if err == nil {
			assigned = sql.NullInt64{Int64: staffID, Valid: true}
		}
	}

	message := SupportChatMessage{Sender: "user", Body: body, Media: []SupportAttachment{}}
	if err = tx.QueryRowContext(ctx, `INSERT INTO support_messages(
		thread_id,sender,sender_provider_id,body
	) VALUES($1,'user',$2,$3) RETURNING id,created_at`, threadID, providerID, body).
		Scan(&message.ID, &message.CreatedAt); err != nil {
		return SupportChatMessage{}, err
	}
	message.Media, err = attachSupportMedia(ctx, tx, message.ID, userID, mediaIDs)
	if err != nil {
		return SupportChatMessage{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE support_threads SET status='open',updated_at=now(),
		assigned_staff_provider_id=$2 WHERE id=$1`, threadID, assigned); err != nil {
		return SupportChatMessage{}, err
	}
	if assigned.Valid {
		kind := "user_message"
		if status != "open" || recent == 0 {
			kind = "request"
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO support_bot_deliveries(
			thread_id,message_id,recipient_provider_id,kind
		) VALUES($1,$2,$3,$4) ON CONFLICT(message_id,recipient_provider_id) DO NOTHING`,
			threadID, message.ID, assigned.Int64, kind); err != nil {
			return SupportChatMessage{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return SupportChatMessage{}, err
	}
	return message, nil
}

func (s *Service) ReplySupportApp(
	ctx context.Context,
	threadID int64,
	staffUserID int64,
	body string,
	mediaIDs []int64,
) (SupportChatMessage, error) {
	body = strings.TrimSpace(body)
	if threadID <= 0 || staffUserID <= 0 || !validAppSupportMessage(body, mediaIDs) {
		return SupportChatMessage{}, ErrInvalid
	}
	providerID, err := s.supportProviderID(ctx, staffUserID)
	if err != nil {
		return SupportChatMessage{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SupportChatMessage{}, err
	}
	defer tx.Rollback()

	var recipient int64
	var status string
	if err = tx.QueryRowContext(ctx, `SELECT provider_user_id,status FROM support_threads
		WHERE id=$1 FOR UPDATE`, threadID).Scan(&recipient, &status); errors.Is(err, sql.ErrNoRows) {
		return SupportChatMessage{}, ErrNotFound
	} else if err != nil {
		return SupportChatMessage{}, err
	}
	if status != "open" {
		return SupportChatMessage{}, ErrConflict
	}
	message := SupportChatMessage{Sender: "staff", Body: body, Media: []SupportAttachment{}}
	if err = tx.QueryRowContext(ctx, `INSERT INTO support_messages(
		thread_id,sender,sender_provider_id,body,delivered_at
	) VALUES($1,'staff',$2,$3,now()) RETURNING id,created_at`, threadID, providerID, body).
		Scan(&message.ID, &message.CreatedAt); err != nil {
		return SupportChatMessage{}, err
	}
	message.Media, err = attachSupportMedia(ctx, tx, message.ID, staffUserID, mediaIDs)
	if err != nil {
		return SupportChatMessage{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE support_threads SET updated_at=now() WHERE id=$1`, threadID); err != nil {
		return SupportChatMessage{}, err
	}
	if err = tx.Commit(); err != nil {
		return SupportChatMessage{}, err
	}

	if sender, ok := s.sender.(interface {
		SendSupportMessage(context.Context, int64, string, string) error
	}); ok {
		notice := body
		if notice == "" {
			notice = "Вам ответили с вложением. Откройте чат поддержки в приложении."
		}
		_ = sender.SendSupportMessage(
			ctx,
			recipient,
			"Поддержка Кутёжа (#"+fmt.Sprint(threadID)+"):\n"+notice,
			"",
		)
	}
	return message, nil
}

func attachSupportMedia(
	ctx context.Context,
	tx *sql.Tx,
	messageID int64,
	ownerID int64,
	mediaIDs []int64,
) ([]SupportAttachment, error) {
	if len(mediaIDs) == 0 {
		return []SupportAttachment{}, nil
	}
	seen := make(map[int64]bool, len(mediaIDs))
	items := make([]SupportAttachment, 0, len(mediaIDs))
	for position, mediaID := range mediaIDs {
		if mediaID <= 0 || seen[mediaID] {
			return nil, ErrInvalid
		}
		seen[mediaID] = true
		var item SupportAttachment
		if err := tx.QueryRowContext(ctx, `SELECT id,mime_type,width,height,duration_ms
			FROM media_assets WHERE id=$1 AND owner_user_id=$2`, mediaID, ownerID).
			Scan(&item.ID, &item.MIMEType, &item.Width, &item.Height, &item.DurationMS); errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalid
		} else if err != nil {
			return nil, err
		}
		if !supportMediaAllowed(item.MIMEType) {
			return nil, ErrInvalid
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO support_message_media(
			message_id,media_id,position
		) VALUES($1,$2,$3)`, messageID, mediaID, position); err != nil {
			return nil, err
		}
		item.URL = "/api/v1/media/" + fmt.Sprint(item.ID) + "/content"
		items = append(items, item)
	}
	return items, nil
}

func (s *Service) ReopenSupport(ctx context.Context, threadID int64) error {
	result, err := s.db.ExecContext(ctx, `UPDATE support_threads SET status='open',updated_at=now()
		WHERE id=$1 AND status='closed'`, threadID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Service) OpenSupportMedia(ctx context.Context, threadID, mediaID int64) (EvidenceMedia, error) {
	if threadID <= 0 || mediaID <= 0 {
		return EvidenceMedia{}, ErrNotFound
	}
	var key, mimeType string
	var size int64
	err := s.db.QueryRowContext(ctx, `
		SELECT asset.storage_key,asset.mime_type,asset.byte_size
		FROM support_message_media link
		JOIN support_messages message ON message.id=link.message_id
		JOIN media_assets asset ON asset.id=link.media_id
		WHERE message.thread_id=$1 AND asset.id=$2`, threadID, mediaID).
		Scan(&key, &mimeType, &size)
	if errors.Is(err, sql.ErrNoRows) {
		return EvidenceMedia{}, ErrNotFound
	}
	if err != nil {
		return EvidenceMedia{}, err
	}
	if !media.ValidStorageKey(key) {
		return EvidenceMedia{}, ErrNotFound
	}
	file, err := os.Open(filepath.Join(s.mediaDir, key))
	if errors.Is(err, os.ErrNotExist) {
		return EvidenceMedia{}, ErrNotFound
	}
	if err != nil {
		return EvidenceMedia{}, fmt.Errorf("open support media: %w", err)
	}
	return EvidenceMedia{MIMEType: mimeType, Size: size, File: file}, nil
}
