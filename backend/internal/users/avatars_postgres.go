package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"kutezh/backend/internal/postgres"
)

func (r *PostgresRepository) SetAvatar(ctx context.Context, userID int64, mediaID *int64) (Profile, error) {
	if mediaID == nil {
		tx, err := r.db.BeginTx(ctx, nil)
		if err != nil {
			return Profile{}, fmt.Errorf("begin avatar clear: %w", err)
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx,
			"UPDATE users SET avatar_media_id = NULL, updated_at = now() WHERE id = $1",
			userID,
		); err != nil {
			return Profile{}, fmt.Errorf("clear primary profile avatar: %w", err)
		}
		profile, err := profileByID(ctx, tx, userID)
		if err != nil {
			return Profile{}, err
		}
		profile.Interests, err = loadInterests(ctx, tx, userID)
		if err != nil {
			return Profile{}, err
		}
		profile.Avatars, err = loadProfileAvatars(ctx, tx, userID)
		if err != nil {
			return Profile{}, err
		}
		if err := tx.Commit(); err != nil {
			return Profile{}, fmt.Errorf("commit avatar clear: %w", err)
		}
		return profile, nil
	}
	return r.SetAvatarCrop(ctx, userID, *mediaID, *mediaID)
}

func (r *PostgresRepository) AddAvatar(ctx context.Context, userID, mediaID int64) (Profile, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, fmt.Errorf("begin profile photo add: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockProfile(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	if err := validateProfileSource(ctx, tx, userID, mediaID); err != nil {
		return Profile{}, err
	}
	if _, err := profileByID(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_profile_avatars (user_id, media_id, position)
		VALUES (
			$1,
			$2,
			COALESCE((SELECT max(position) + 1 FROM user_profile_avatars WHERE user_id = $1), 0)
		)
		ON CONFLICT (user_id, media_id) DO NOTHING`, userID, mediaID); err != nil {
		return Profile{}, fmt.Errorf("add profile photo: %w", err)
	}
	profile, err := profileByID(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Interests, err = loadInterests(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Avatars, err = loadProfileAvatars(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	if err := tx.Commit(); err != nil {
		return Profile{}, fmt.Errorf("commit profile photo add: %w", err)
	}
	return profile, nil
}

func (r *PostgresRepository) SetAvatarCrop(ctx context.Context, userID, sourceMediaID, cropMediaID int64) (Profile, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, fmt.Errorf("begin avatar crop update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockProfile(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	mediaIDs := []int64{sourceMediaID}
	if cropMediaID != sourceMediaID {
		mediaIDs = append(mediaIDs, cropMediaID)
	}
	if err := postgres.LockMediaAssets(ctx, tx, userID, mediaIDs); err != nil {
		return Profile{}, err
	}
	if err := validateProfileSourceAfterLock(ctx, tx, userID, sourceMediaID); err != nil {
		return Profile{}, err
	}
	if err := validateProfileCropAfterLock(ctx, tx, userID, cropMediaID); err != nil {
		return Profile{}, err
	}
	if _, err := profileByID(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE user_profile_avatars SET position = position + 1 WHERE user_id = $1 AND media_id <> $2",
		userID, sourceMediaID,
	); err != nil {
		return Profile{}, fmt.Errorf("shift profile photos: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_profile_avatars (user_id, media_id, crop_media_id, position)
		VALUES ($1, $2, $3, 0)
		ON CONFLICT (user_id, media_id) DO UPDATE
		SET crop_media_id = EXCLUDED.crop_media_id, position = 0`, userID, sourceMediaID, cropMediaID); err != nil {
		return Profile{}, fmt.Errorf("save profile avatar crop: %w", err)
	}
	if err := normalizeAvatarPositions(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE users SET avatar_media_id = $2, updated_at = now() WHERE id = $1",
		userID, cropMediaID,
	); err != nil {
		return Profile{}, fmt.Errorf("set primary profile avatar crop: %w", err)
	}
	profile, err := profileByID(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Interests, err = loadInterests(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Avatars, err = loadProfileAvatars(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	if err := tx.Commit(); err != nil {
		return Profile{}, fmt.Errorf("commit avatar crop update: %w", err)
	}
	return profile, nil
}

func validateProfileSource(ctx context.Context, tx *sql.Tx, userID, mediaID int64) error {
	if err := postgres.LockMediaAssets(ctx, tx, userID, []int64{mediaID}); err != nil {
		return err
	}
	return validateProfileSourceAfterLock(ctx, tx, userID, mediaID)
}

func validateProfileSourceAfterLock(ctx context.Context, tx *sql.Tx, userID, mediaID int64) error {
	var valid bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM media_assets media
			WHERE media.id = $1 AND media.owner_user_id = $2
				AND media.moderated_safe
				AND media.mime_type IN ('image/jpeg', 'image/png')
				AND NOT EXISTS (SELECT 1 FROM post_media WHERE media_id = media.id)
				AND NOT EXISTS (SELECT 1 FROM comment_media WHERE media_id = media.id)
				AND NOT EXISTS (SELECT 1 FROM attendance_media WHERE media_id = media.id)
		)`, mediaID, userID).Scan(&valid); err != nil {
		return fmt.Errorf("validate profile photo source: %w", err)
	}
	if !valid {
		return ErrInvalidAvatar
	}
	return nil
}

func validateProfileCropAfterLock(ctx context.Context, tx *sql.Tx, userID, mediaID int64) error {
	var valid bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM media_assets media
			WHERE media.id = $1 AND media.owner_user_id = $2
				AND media.moderated_safe
				AND media.mime_type IN ('image/jpeg', 'image/png')
				AND media.width = media.height AND media.width <= 512
				AND NOT EXISTS (SELECT 1 FROM post_media WHERE media_id = media.id)
				AND NOT EXISTS (SELECT 1 FROM comment_media WHERE media_id = media.id)
				AND NOT EXISTS (SELECT 1 FROM attendance_media WHERE media_id = media.id)
		)`, mediaID, userID).Scan(&valid); err != nil {
		return fmt.Errorf("validate profile avatar crop: %w", err)
	}
	if !valid {
		return ErrInvalidAvatar
	}
	return nil
}

func (r *PostgresRepository) RemoveAvatar(ctx context.Context, userID, mediaID int64) (Profile, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, fmt.Errorf("begin profile photo delete: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockProfile(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	var cropID sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		"SELECT crop_media_id FROM user_profile_avatars WHERE user_id = $1 AND media_id = $2 FOR UPDATE",
		userID, mediaID,
	).Scan(&cropID); errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrInvalidAvatar
	} else if err != nil {
		return Profile{}, fmt.Errorf("lock profile photo: %w", err)
	}
	var current sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT avatar_media_id FROM users WHERE id = $1 FOR UPDATE", userID).Scan(&current); errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	} else if err != nil {
		return Profile{}, fmt.Errorf("lock current profile avatar: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM user_profile_avatars WHERE user_id = $1 AND media_id = $2",
		userID, mediaID,
	); err != nil {
		return Profile{}, fmt.Errorf("delete profile photo: %w", err)
	}
	if current.Valid && cropID.Valid && current.Int64 == cropID.Int64 {
		if _, err := tx.ExecContext(ctx,
			"UPDATE users SET avatar_media_id = NULL, updated_at = now() WHERE id = $1",
			userID,
		); err != nil {
			return Profile{}, fmt.Errorf("clear removed primary avatar: %w", err)
		}
	}
	if err := normalizeAvatarPositions(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	profile, err := profileByID(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Interests, err = loadInterests(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Avatars, err = loadProfileAvatars(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	if err := tx.Commit(); err != nil {
		return Profile{}, fmt.Errorf("commit profile photo delete: %w", err)
	}
	return profile, nil
}

func (r *PostgresRepository) ReorderAvatars(ctx context.Context, userID int64, mediaIDs []int64) (Profile, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, fmt.Errorf("begin profile photo reorder: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockProfile(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	if _, err := profileByID(ctx, tx, userID); err != nil {
		return Profile{}, err
	}
	rows, err := tx.QueryContext(ctx,
		"SELECT media_id FROM user_profile_avatars WHERE user_id = $1 ORDER BY position, created_at, media_id FOR UPDATE",
		userID,
	)
	if err != nil {
		return Profile{}, fmt.Errorf("lock profile photos: %w", err)
	}
	current := make([]int64, 0, len(mediaIDs))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return Profile{}, fmt.Errorf("scan profile photo: %w", err)
		}
		current = append(current, id)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return Profile{}, fmt.Errorf("iterate profile photos: %w", err)
	}
	if err := rows.Close(); err != nil {
		return Profile{}, fmt.Errorf("close profile photos: %w", err)
	}
	if len(current) != len(mediaIDs) {
		return Profile{}, ErrInvalidAvatar
	}
	expected := make(map[int64]struct{}, len(current))
	for _, id := range current {
		expected[id] = struct{}{}
	}
	for _, id := range mediaIDs {
		if _, ok := expected[id]; !ok {
			return Profile{}, ErrInvalidAvatar
		}
		delete(expected, id)
	}
	if len(expected) != 0 {
		return Profile{}, ErrInvalidAvatar
	}
	var firstCropID sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		"SELECT crop_media_id FROM user_profile_avatars WHERE user_id = $1 AND media_id = $2",
		userID, mediaIDs[0],
	).Scan(&firstCropID); err != nil {
		return Profile{}, fmt.Errorf("read first profile photo crop: %w", err)
	}
	if !firstCropID.Valid {
		return Profile{}, ErrInvalidAvatar
	}
	if _, err := tx.ExecContext(ctx, `
  UPDATE user_profile_avatars avatar SET position = item.position - 1
  FROM unnest($2::bigint[]) WITH ORDINALITY AS item(media_id, position)
  WHERE avatar.user_id = $1 AND avatar.media_id = item.media_id`, userID, mediaIDs); err != nil {
		return Profile{}, fmt.Errorf("reorder profile photos: %w", err)
	}

	if _, err := tx.ExecContext(ctx,
		"UPDATE users SET avatar_media_id = $2, updated_at = CASE WHEN avatar_media_id IS DISTINCT FROM $2 THEN now() ELSE updated_at END WHERE id = $1",
		userID, firstCropID.Int64,
	); err != nil {
		return Profile{}, fmt.Errorf("set reordered primary avatar: %w", err)
	}
	profile, err := profileByID(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Interests, err = loadInterests(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Avatars, err = loadProfileAvatars(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	if err := tx.Commit(); err != nil {
		return Profile{}, fmt.Errorf("commit profile photo reorder: %w", err)
	}
	return profile, nil
}

type profileRowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func profileByID(ctx context.Context, q profileRowQueryer, userID int64) (Profile, error) {
	const query = `
		SELECT id, first_name, last_name, display_name, bio, city, COALESCE(gender, ''),
			language_code, CASE WHEN avatar_media_id IS NULL THEN provider_photo_url ELSE '/api/v1/media/' || avatar_media_id::text || '/content' END,
			avatar_media_id, username, participant_visibility, COALESCE(equipped_decoration_code, ''), onboarding_version,
			birth_date, CASE WHEN birth_date IS NULL THEN NULL ELSE date_part('year', age(current_date, birth_date))::integer END,
			face_verified_at IS NOT NULL,
			CASE WHEN face_verified_at IS NULL THEN 'none' WHEN (face_avatar_verified_media_id = avatar_media_id OR EXISTS (SELECT 1 FROM user_profile_avatars a WHERE a.user_id = users.id AND face_avatar_verified_media_id IN (a.media_id, a.crop_media_id))) THEN 'full' ELSE 'age' END,
			true, created_at, updated_at, kutezh_staff_role(id), hide_sensitive_language, show_online, private_profile, show_birth_date
		FROM users WHERE id = $1`
	profile, err := scanProfile(q.QueryRowContext(ctx, query, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, fmt.Errorf("get profile after avatar change: %w", err)
	}
	return profile, nil
}

func normalizeAvatarPositions(ctx context.Context, tx *sql.Tx, userID int64) error {
	_, err := tx.ExecContext(ctx, `
  UPDATE user_profile_avatars avatar SET position = ordered.position
  FROM (
   SELECT media_id, row_number() OVER (ORDER BY position, created_at, media_id) - 1 AS position
   FROM user_profile_avatars WHERE user_id = $1
  ) ordered
  WHERE avatar.user_id = $1 AND avatar.media_id = ordered.media_id`, userID)
	if err != nil {
		return fmt.Errorf("sort profile photos: %w", err)
	}
	return nil
}

func lockProfile(ctx context.Context, tx *sql.Tx, userID int64) error {
	var id int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM users WHERE id = $1 FOR UPDATE", userID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("lock profile: %w", err)
	}
	return nil
}
