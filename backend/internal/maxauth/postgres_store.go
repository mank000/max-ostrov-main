package maxauth

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type PostgresSessionStore struct {
	db *sql.DB
}

func NewPostgresSessionStore(db *sql.DB) *PostgresSessionStore {
	return &PostgresSessionStore{db: db}
}

func (s *PostgresSessionStore) Save(key [sha256.Size]byte, session Session, now time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO auth_sessions (
			token_hash, user_id, first_name, last_name, language_code, photo_url, expires_at, created_at
		) SELECT $1,$2,$3,$4,$5,$6,$7,$8 FROM users
		WHERE id=$2 AND moderation_suspended_at IS NULL
		ON CONFLICT (token_hash) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			first_name = EXCLUDED.first_name,
			last_name = EXCLUDED.last_name,
			language_code = EXCLUDED.language_code,
			photo_url = EXCLUDED.photo_url,
			expires_at = EXCLUDED.expires_at`,
		key[:], session.User.ID, session.User.FirstName, session.User.LastName,
		session.User.LanguageCode, session.User.PhotoURL, session.ExpiresAt, now,
	)
	if err != nil {
		return fmt.Errorf("save auth session: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check saved auth session: %w", err)
	}
	if rows > 0 {
		return nil
	}
	var suspended bool
	if err := s.db.QueryRowContext(ctx, `SELECT moderation_suspended_at IS NOT NULL FROM users WHERE id=$1`, session.User.ID).Scan(&suspended); errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidSession
	} else if err != nil {
		return fmt.Errorf("check auth session account: %w", err)
	}
	if suspended {
		return ErrSuspended
	}
	return ErrInvalidSession
}

func (s *PostgresSessionStore) Load(key [sha256.Size]byte, now time.Time) (Session, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var session Session
	err := s.db.QueryRowContext(ctx, `
		SELECT session.user_id, session.first_name, session.last_name,
			session.language_code, session.photo_url, session.expires_at, identity.provider_user_id
		FROM auth_sessions session JOIN users account ON account.id=session.user_id
		JOIN user_identities identity ON identity.user_id=session.user_id AND identity.provider='max'
		WHERE token_hash = $1 AND expires_at > $2 AND account.moderation_suspended_at IS NULL`,
		key[:], now,
	).Scan(
		&session.User.ID, &session.User.FirstName, &session.User.LastName,
		&session.User.LanguageCode, &session.User.PhotoURL, &session.ExpiresAt, &session.User.ProviderUserID,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrInvalidSession
	}
	if err != nil {
		return Session{}, fmt.Errorf("load auth session: %w", err)
	}
	return session, nil
}

func (s *PostgresSessionStore) Delete(key [sha256.Size]byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE token_hash = $1`, key[:]); err != nil {
		return fmt.Errorf("delete auth session: %w", err)
	}
	return nil
}

func (s *PostgresSessionStore) Prune(now time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE expires_at <= $1`, now); err != nil {
		return fmt.Errorf("prune auth sessions: %w", err)
	}
	return nil
}
