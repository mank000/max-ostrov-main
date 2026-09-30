package moderation

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"errors"
	"github.com/jackc/pgx/v5/pgconn"
)

type ManagedUser struct {
	ID          int64     `json:"id"`
	MAXUserID   int64     `json:"max_user_id"`
	DisplayName string    `json:"display_name"`
	Username    string    `json:"username"`
	City        string    `json:"city"`
	Role        string    `json:"role"`
	Suspended   bool      `json:"suspended"`
	CreatedAt   time.Time `json:"created_at"`
}

type ManagedContent struct {
	ID         int64      `json:"id"`
	TargetType TargetType `json:"target_type"`
	AuthorID   int64      `json:"author_id"`
	AuthorName string     `json:"author_name"`
	Text       string     `json:"text"`
	Hidden     bool       `json:"hidden"`
	CreatedAt  time.Time  `json:"created_at"`
}

type DirectAction struct {
	TargetType TargetType `json:"target_type"`
	TargetID   int64      `json:"target_id"`
	Action     string     `json:"action"`
	Reason     string     `json:"reason"`
}

func (s *Service) PrincipalForUser(ctx context.Context, userID int64) (Principal, error) {
	role, err := staffRole(ctx, s.db, userID)
	if err != nil {
		return Principal{}, err
	}
	if role == "" {
		return Principal{}, ErrForbidden
	}
	return Principal{UserID: userID, Role: role}, nil
}

func (s *Service) Manage(ctx context.Context, actorID int64, input DirectAction) error {
	input.Reason = strings.TrimSpace(input.Reason)
	if !input.TargetType.Valid() || input.TargetID <= 0 || utf8.RuneCountInString(input.Reason) < 3 || utf8.RuneCountInString(input.Reason) > 500 || input.Action == "dismiss" {
		return ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	role, err := staffRole(ctx, tx, actorID)
	if err != nil {
		return err
	}
	if role != "administrator" {
		return ErrForbidden
	}
	previous, next, err := applyAction(ctx, tx, actorID, role, input.TargetType, input.TargetID, input.Action, s.now())
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrConflict
		}
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO moderation_actions(actor_user_id,target_type,target_id,action,reason,previous_state,next_state)
 VALUES($1,$2,$3,$4,$5,$6,$7)`, actorID, input.TargetType, input.TargetID, input.Action, input.Reason, previous, next)
	if err != nil {
		return fmt.Errorf("audit direct moderation: %w", err)
	}
	// Deliver a general refresh only; no private content or identity is broadcast.
	payload, _ := json.Marshal(map[string]any{"source": "moderation", "broadcast": true, "event": map[string]any{"type": "sync.required", "payload": map[string]any{}, "occurred_at": s.now().UTC()}})
	if _, err = tx.ExecContext(ctx, `SELECT pg_notify('kutezh_updates',$1)`, string(payload)); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) ListUsers(ctx context.Context, query, status string, beforeID int64, limit int) ([]ManagedUser, *int64, error) {
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 100 || (status != "all" && status != "suspended" && status != "active") || beforeID < 0 || limit < 1 || limit > 100 {
		return nil, nil, ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, `SELECT u.id, COALESCE(i.provider_user_id,0),u.display_name,u.username,u.city,
 COALESCE((SELECT role FROM user_roles WHERE user_id=u.id ORDER BY (role='administrator') DESC LIMIT 1),''),
 u.moderation_suspended_at IS NOT NULL,u.created_at
 FROM users u LEFT JOIN user_identities i ON i.user_id=u.id AND i.provider='max' AND i.status='verified'
 WHERE ($1='' OR strpos(lower(u.display_name),lower($1))>0 OR strpos(lower(u.username),lower($1))>0 OR u.id::text=$1 OR i.provider_user_id::text=$1)
 AND ($2='all' OR ($2='suspended')=(u.moderation_suspended_at IS NOT NULL)) AND ($3::bigint=0 OR u.id<$3)
 ORDER BY u.id DESC LIMIT $4`, query, status, beforeID, limit+1)
	if err != nil {
		return nil, nil, fmt.Errorf("list managed users: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []ManagedUser{}
	for rows.Next() {
		var item ManagedUser
		if err := rows.Scan(&item.ID, &item.MAXUserID, &item.DisplayName, &item.Username, &item.City, &item.Role, &item.Suspended, &item.CreatedAt); err != nil {
			return nil, nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if len(items) > limit {
		items = items[:limit]
		cursor := items[len(items)-1].ID
		return items, &cursor, nil
	}
	return items, nil, nil
}

func (s *Service) ListContent(ctx context.Context, kind TargetType, query, status string, beforeID int64, limit int) ([]ManagedContent, *int64, error) {
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 100 || (status != "all" && status != "hidden" && status != "visible") || beforeID < 0 || limit < 1 || limit > 100 {
		return nil, nil, ErrInvalid
	}
	table, author, body := "", "", ""
	switch kind {
	case TargetPost:
		table, author, body = "posts", "author_user_id", "caption"
	case TargetComment:
		table, author, body = "post_comments", "author_user_id", "body"
	case TargetEvent:
		table, author, body = "events", "created_by_user_id", "title"
	default:
		return nil, nil, ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, `SELECT c.id,COALESCE(c.`+author+`,0),COALESCE(u.display_name,'Удалённый пользователь'),left(c.`+body+`,500),c.moderation_hidden_at IS NOT NULL,c.created_at
 FROM `+table+` c LEFT JOIN users u ON u.id=c.`+author+`
 WHERE ($1='' OR strpos(lower(c.`+body+`),lower($1))>0 OR c.id::text=$1 OR c.`+author+`::text=$1)
 AND ($2='all' OR ($2='hidden')=(c.moderation_hidden_at IS NOT NULL)) AND ($3::bigint=0 OR c.id<$3)
 ORDER BY c.id DESC LIMIT $4`, query, status, beforeID, limit+1)
	if err != nil {
		return nil, nil, fmt.Errorf("list managed content: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []ManagedContent{}
	for rows.Next() {
		item := ManagedContent{TargetType: kind}
		if err := rows.Scan(&item.ID, &item.AuthorID, &item.AuthorName, &item.Text, &item.Hidden, &item.CreatedAt); err != nil {
			return nil, nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	if len(items) > limit {
		items = items[:limit]
		cursor := items[len(items)-1].ID
		return items, &cursor, nil
	}
	return items, nil, nil
}
