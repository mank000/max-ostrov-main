package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"kutezh/backend/internal/postgres"

	"kutezh/backend/internal/maxauth"
)

func (r *PostgresRepository) UpsertProviderUser(
	ctx context.Context,
	provider AuthProvider,
	user maxauth.User,
	displayName string,
) (Profile, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, fmt.Errorf("begin provider user upsert: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := postgres.LockRow(ctx, tx, postgres.IdentityLock, user.ID); err != nil {
		return Profile{}, fmt.Errorf("lock provider identity: %w", err)
	}

	var userID int64
	created := false
	err = tx.QueryRowContext(ctx, `
		SELECT user_id FROM user_identities
		WHERE provider = $1 AND provider_user_id = $2`, provider, user.ID,
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		if userID == 0 {
			err = tx.QueryRowContext(ctx, `
				INSERT INTO users (first_name, last_name, display_name, language_code, provider_photo_url)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING id`, user.FirstName, user.LastName, displayName, user.LanguageCode, user.PhotoURL,
			).Scan(&userID)
			if err != nil {
				return Profile{}, fmt.Errorf("create provider user: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_identities (provider, provider_user_id, user_id, provider_username)
			VALUES ($1, $2, $3, NULLIF($4, ''))`, provider, user.ID, userID, user.Username,
			); err != nil {
				return Profile{}, fmt.Errorf("link provider identity: %w", err)
			}
			created = true
		}
	} else if err != nil {
		return Profile{}, fmt.Errorf("find provider identity: %w", err)
	}

	if created {
		if referrerID, ok := referralUserID(user.StartParam); ok && referrerID != userID {
			if err := creditReferral(ctx, tx, referrerID, userID); err != nil {
				return Profile{}, fmt.Errorf("credit referral: %w", err)
			}
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE user_identities SET provider_username = NULLIF($3, '')
		WHERE provider = $1 AND provider_user_id = $2`, provider, user.ID, user.Username,
	); err != nil {
		return Profile{}, fmt.Errorf("refresh provider username: %w", err)
	}

	const query = `
		UPDATE users SET
			first_name = $2,
			last_name = $3,
			language_code = $4,
			provider_photo_url = $5,
			updated_at = now()
		WHERE id = $1
		RETURNING id, first_name, last_name, display_name, bio, city, COALESCE(gender, ''),
			language_code, CASE WHEN avatar_media_id IS NULL THEN provider_photo_url ELSE '/api/v1/media/' || avatar_media_id::text || '/content' END,
			avatar_media_id, username, participant_visibility, COALESCE(equipped_decoration_code, ''), onboarding_version,
			birth_date, CASE WHEN birth_date IS NULL THEN NULL ELSE date_part('year', age(current_date, birth_date))::integer END,
			face_verified_at IS NOT NULL,
			CASE WHEN face_verified_at IS NULL THEN 'none' WHEN (face_avatar_verified_media_id = avatar_media_id OR EXISTS (SELECT 1 FROM user_profile_avatars a WHERE a.user_id = users.id AND face_avatar_verified_media_id IN (a.media_id, a.crop_media_id))) THEN 'full' ELSE 'age' END,
			true, created_at, updated_at, kutezh_staff_role(id), hide_sensitive_language, show_online, private_profile, show_birth_date`
	profile, err := scanProfile(tx.QueryRowContext(ctx, query,
		userID, user.FirstName, user.LastName, user.LanguageCode, user.PhotoURL,
	))
	if err != nil {
		return Profile{}, fmt.Errorf("update provider user: %w", err)
	}
	profile.Interests, err = loadInterests(ctx, tx, profile.ID)
	if err != nil {
		return Profile{}, err
	}
	profile.Avatars, err = loadProfileAvatars(ctx, tx, profile.ID)
	if err != nil {
		return Profile{}, err
	}
	if err := tx.Commit(); err != nil {
		return Profile{}, fmt.Errorf("commit provider user upsert: %w", err)
	}
	return profile, nil
}
