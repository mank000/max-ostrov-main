package moderation

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"kutezh/backend/internal/postgres"
	"log/slog"
	"math/big"
	"strings"
	"time"
)

const challengeTTL = 5 * time.Minute
const sessionTTL = 10 * 365 * 24 * time.Hour

func randomToken(source interface{ Read([]byte) (int, error) }, size int) (string, error) {
	value := make([]byte, size)
	if _, err := io.ReadFull(source, value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func (s *Service) codeHash(challengeID, code string) [sha256.Size]byte {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(challengeID))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(code))
	var result [sha256.Size]byte
	copy(result[:], mac.Sum(nil))
	return result
}

func (s *Service) Challenge(ctx context.Context, maxUserID int64) (string, error) {
	if !s.LoginReady() {
		return "", ErrUnavailable
	}
	if maxUserID <= 0 {
		return "", ErrInvalid
	}
	id, err := randomToken(s.random, 24)
	if err != nil {
		return "", fmt.Errorf("generate moderation challenge: %w", err)
	}
	now := s.now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin moderation challenge: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := postgres.LockRow(ctx, tx, postgres.ModeratorLoginLock, maxUserID); err != nil {
		return "", fmt.Errorf("lock moderation challenge limit: %w", err)
	}
	var recent int
	if err := tx.QueryRowContext(ctx, `
		SELECT count(*) FROM moderation_login_challenges
		WHERE max_user_id = $1 AND created_at > $2`, maxUserID, now.Add(-15*time.Minute)).Scan(&recent); err != nil {
		return "", fmt.Errorf("check moderation challenge limit: %w", err)
	}
	if recent >= 3 {
		return id, nil
	}
	var userID sql.NullInt64
	err = tx.QueryRowContext(ctx, `
		SELECT identity.user_id
		FROM user_identities identity
		JOIN users account ON account.id = identity.user_id
		WHERE identity.provider = 'max' AND identity.provider_user_id = $1
			AND identity.status = 'verified' AND account.moderation_suspended_at IS NULL
			AND EXISTS (SELECT 1 FROM user_roles role WHERE role.user_id = identity.user_id
				AND role.role IN ('moderator', 'administrator'))`, maxUserID).Scan(&userID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("find moderation identity: %w", err)
	}
	codeNumber, err := rand.Int(s.random, big.NewInt(10_000_000_000))
	if err != nil {
		return "", fmt.Errorf("generate moderation code: %w", err)
	}
	code := fmt.Sprintf("%010d", codeNumber.Int64())
	hash := s.codeHash(id, code)
	var storedUserID any
	if userID.Valid {
		storedUserID = userID.Int64
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderation_login_challenges
			(id, user_id, max_user_id, code_hash, expires_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, storedUserID, maxUserID, hash[:], now.Add(challengeTTL), now); err != nil {
		return "", fmt.Errorf("save moderation challenge: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit moderation challenge: %w", err)
	}
	if userID.Valid {
		if err := s.sender.SendCode(ctx, maxUserID, code); err != nil {
			_, _ = s.db.ExecContext(ctx, `DELETE FROM moderation_login_challenges WHERE id = $1`, id)
			slog.Warn("moderation code delivery failed", "error", err)
		}
	}
	return id, nil
}

func (s *Service) Verify(ctx context.Context, challengeID, code string) (string, Principal, error) {
	if !s.LoginReady() {
		return "", Principal{}, ErrUnavailable
	}
	if len(challengeID) < 24 || len(challengeID) > 80 || len(code) != 10 || strings.Trim(code, "0123456789") != "" {
		return "", Principal{}, ErrAuth
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", Principal{}, fmt.Errorf("begin moderation verification: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var userID sql.NullInt64
	var maxID int64
	var storedHash []byte
	var attempts int
	var expiresAt time.Time
	var consumedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `
		SELECT user_id, max_user_id, code_hash, attempts, expires_at, consumed_at
		FROM moderation_login_challenges WHERE id = $1 FOR UPDATE`, challengeID,
	).Scan(&userID, &maxID, &storedHash, &attempts, &expiresAt, &consumedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", Principal{}, ErrAuth
	}
	if err != nil {
		return "", Principal{}, fmt.Errorf("load moderation challenge: %w", err)
	}
	now := s.now()
	if attempts >= 5 || consumedAt.Valid || !now.Before(expiresAt) {
		return "", Principal{}, ErrAuth
	}
	hash := s.codeHash(challengeID, code)
	if !userID.Valid || !hmac.Equal(storedHash, hash[:]) {
		if _, err := tx.ExecContext(ctx, `UPDATE moderation_login_challenges SET attempts = attempts + 1 WHERE id = $1`, challengeID); err != nil {
			return "", Principal{}, fmt.Errorf("record moderation code attempt: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return "", Principal{}, fmt.Errorf("commit moderation code attempt: %w", err)
		}
		return "", Principal{}, ErrAuth
	}
	role, err := roleForIdentity(ctx, tx, userID.Int64, maxID)
	if err != nil {
		return "", Principal{}, err
	}
	if role == "" {
		return "", Principal{}, ErrAuth
	}
	if _, err := tx.ExecContext(ctx, `UPDATE moderation_login_challenges SET consumed_at = $2 WHERE id = $1`, challengeID, now); err != nil {
		return "", Principal{}, fmt.Errorf("consume moderation challenge: %w", err)
	}
	token, err := randomToken(s.random, 32)
	if err != nil {
		return "", Principal{}, fmt.Errorf("generate moderation session: %w", err)
	}
	tokenHash := sha256.Sum256([]byte(token))
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO moderation_sessions(token_hash,user_id,created_at,last_seen_at,expires_at)
		VALUES($1,$2,$3,$3,$4)`, tokenHash[:], userID.Int64, now, now.Add(sessionTTL)); err != nil {
		return "", Principal{}, fmt.Errorf("save moderation session: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", Principal{}, fmt.Errorf("commit moderation login: %w", err)
	}
	return token, Principal{UserID: userID.Int64, Role: role}, nil
}

type queryRowContext interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func roleForIdentity(ctx context.Context, q queryRowContext, userID, maxID int64) (string, error) {
	var role string
	err := q.QueryRowContext(ctx, `
		SELECT role.role FROM user_roles role
		JOIN users account ON account.id = role.user_id
		JOIN user_identities identity ON identity.user_id = role.user_id
		WHERE role.user_id = $1 AND identity.provider = 'max'
			AND identity.provider_user_id = $2 AND identity.status = 'verified'
			AND account.moderation_suspended_at IS NULL
		ORDER BY (role.role = 'administrator') DESC LIMIT 1`, userID, maxID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("check moderation role: %w", err)
	}
	return role, nil
}

func (s *Service) Session(ctx context.Context, token string) (Principal, error) {
	if token == "" {
		return Principal{}, ErrAuth
	}
	hash := sha256.Sum256([]byte(token))
	now := s.now()
	var userID int64
	err := s.db.QueryRowContext(ctx, `
		UPDATE moderation_sessions session SET last_seen_at = $2, expires_at = $3
		WHERE token_hash = $1 AND expires_at > $2
			AND EXISTS (SELECT 1 FROM users account WHERE account.id = session.user_id
				AND account.moderation_suspended_at IS NULL)
			AND EXISTS (SELECT 1 FROM user_roles role WHERE role.user_id = session.user_id
				AND role.role IN ('moderator','administrator'))
			AND EXISTS (SELECT 1 FROM user_identities identity WHERE identity.user_id = session.user_id
				AND identity.provider = 'max' AND identity.status = 'verified')
		RETURNING user_id`, hash[:], now, now.Add(sessionTTL)).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return Principal{}, ErrAuth
	}
	if err != nil {
		return Principal{}, fmt.Errorf("load moderation session: %w", err)
	}
	var role string
	if err := s.db.QueryRowContext(ctx, `
		SELECT role FROM user_roles WHERE user_id = $1
		ORDER BY (role = 'administrator') DESC LIMIT 1`, userID).Scan(&role); err != nil {
		return Principal{}, ErrAuth
	}
	return Principal{UserID: userID, Role: role}, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	hash := sha256.Sum256([]byte(token))
	if _, err := s.db.ExecContext(ctx, `DELETE FROM moderation_sessions WHERE token_hash = $1`, hash[:]); err != nil {
		return fmt.Errorf("delete moderation session: %w", err)
	}
	return nil
}

func (s *Service) PrincipalForMAX(ctx context.Context, maxID int64) (Principal, error) {
	if maxID <= 0 {
		return Principal{}, ErrAuth
	}
	var userID int64
	err := s.db.QueryRowContext(ctx, `SELECT identity.user_id FROM user_identities identity
		JOIN users account ON account.id=identity.user_id
		WHERE identity.provider='max' AND identity.provider_user_id=$1
			AND identity.status='verified' AND account.moderation_suspended_at IS NULL`, maxID).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return Principal{}, ErrForbidden
	}
	if err != nil {
		return Principal{}, fmt.Errorf("resolve moderator MAX identity: %w", err)
	}
	role, err := roleForIdentity(ctx, s.db, userID, maxID)
	if err != nil {
		return Principal{}, err
	}
	if role == "" {
		return Principal{}, ErrForbidden
	}
	return Principal{UserID: userID, Role: role}, nil
}
