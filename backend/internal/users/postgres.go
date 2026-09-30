package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) TouchPresence(ctx context.Context, userID int64) error {
	result, err := r.db.ExecContext(ctx, "UPDATE users SET last_seen_at = now() WHERE id = $1", userID)
	if err != nil {
		return fmt.Errorf("touch user presence: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read user presence update: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) Get(ctx context.Context, userID int64) (Profile, error) {
	const query = `
		SELECT id, first_name, last_name, display_name, bio, city, COALESCE(gender, ''),
			language_code, CASE WHEN avatar_media_id IS NULL THEN provider_photo_url ELSE '/api/v1/media/' || avatar_media_id::text || '/content' END,
			avatar_media_id, username, participant_visibility, COALESCE(equipped_decoration_code, ''), onboarding_version,
			birth_date, CASE WHEN birth_date IS NULL THEN NULL ELSE date_part('year', age(current_date, birth_date))::integer END,
			face_verified_at IS NOT NULL,
			CASE WHEN face_verified_at IS NULL THEN 'none' WHEN (face_avatar_verified_media_id = avatar_media_id OR EXISTS (SELECT 1 FROM user_profile_avatars a WHERE a.user_id = users.id AND face_avatar_verified_media_id IN (a.media_id, a.crop_media_id))) THEN 'full' ELSE 'age' END,
			true, created_at, updated_at, kutezh_staff_role(id), hide_sensitive_language, show_online, private_profile, show_birth_date
		FROM users WHERE id = $1`
	profile, err := scanProfile(r.db.QueryRowContext(ctx, query, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, fmt.Errorf("get user: %w", err)
	}
	return r.withDetails(ctx, profile)
}

func (r *PostgresRepository) Update(ctx context.Context, userID int64, update Update) (Profile, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Profile{}, fmt.Errorf("begin profile update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	const query = `
		UPDATE users SET
			username = COALESCE($2, username),
			display_name = COALESCE($3, display_name),
			bio = COALESCE($4, bio),
			city = COALESCE($5, city),
			participant_visibility = COALESCE($6, participant_visibility),
			onboarding_version = CASE WHEN COALESCE($7, false) THEN GREATEST(onboarding_version, 1) ELSE onboarding_version END,
			face_verified_at = CASE WHEN $8::date IS NOT NULL AND birth_date IS DISTINCT FROM $8::date THEN NULL ELSE face_verified_at END,
			face_avatar_verified_media_id = CASE WHEN $8::date IS NOT NULL AND birth_date IS DISTINCT FROM $8::date THEN NULL ELSE face_avatar_verified_media_id END,
			birth_date = COALESCE($8::date, birth_date),
 hide_sensitive_language = CASE WHEN COALESCE($8::date,birth_date) IS NULL
    OR COALESCE($8::date,birth_date) > (CURRENT_DATE - INTERVAL '18 years')::date
    THEN true ELSE COALESCE($9,hide_sensitive_language) END,
			gender = COALESCE($10, gender),
			show_online = COALESCE($11, show_online),
			private_profile = COALESCE($12, private_profile),
			show_birth_date = COALESCE($13, show_birth_date),
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
		userID, update.Username, update.DisplayName, update.Bio, update.City, update.ParticipantVisibility, update.OnboardingComplete, update.BirthDate, update.HideSensitiveLanguage, update.Gender, update.ShowOnline, update.PrivateProfile, update.ShowBirthDate,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			return Profile{}, ErrUsernameTaken
		}
		return Profile{}, fmt.Errorf("update profile: %w", err)
	}

	if update.ShowBirthDate != nil && !*update.ShowBirthDate {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM notifications
			WHERE kind = 'friend_birthday' AND actor_user_id = $1`, userID); err != nil {
			return Profile{}, fmt.Errorf("remove hidden birthday notifications: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM background_jobs
			WHERE kind = 'notification' AND finished_at IS NULL
				AND payload->>'kind' = 'friend_birthday'
				AND payload->>'actor_user_id' = $1::text`, userID); err != nil {
			return Profile{}, fmt.Errorf("remove hidden birthday jobs: %w", err)
		}
	}

	if update.Interests != nil {
		if _, err := tx.ExecContext(ctx, "DELETE FROM user_interests WHERE user_id = $1", userID); err != nil {
			return Profile{}, fmt.Errorf("replace interests: %w", err)
		}
		for position, interest := range *update.Interests {
			if _, err := tx.ExecContext(ctx,
				"INSERT INTO user_interests (user_id, interest, position) VALUES ($1, $2, $3)",
				userID, interest, position,
			); err != nil {
				return Profile{}, fmt.Errorf("insert interest: %w", err)
			}
		}
	}

	interests, err := loadInterests(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	profile.Interests = interests
	profile.Avatars, err = loadProfileAvatars(ctx, tx, userID)
	if err != nil {
		return Profile{}, err
	}
	if err := tx.Commit(); err != nil {
		return Profile{}, fmt.Errorf("commit profile update: %w", err)
	}
	return profile, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanProfile(row rowScanner) (Profile, error) {
	var profile Profile
	var birthDate sql.NullTime
	var age sql.NullInt64
	err := row.Scan(
		&profile.ID, &profile.FirstName, &profile.LastName, &profile.DisplayName,
		&profile.Bio, &profile.City, &profile.Gender, &profile.LanguageCode, &profile.PhotoURL,
		&profile.AvatarMediaID, &profile.Username, &profile.ParticipantVisibility,
		&profile.EquippedDecorationCode, &profile.OnboardingVersion,
		&birthDate, &age, &profile.FaceVerified, &profile.VerificationTier, &profile.FaceVerificationAvailable,
		&profile.CreatedAt, &profile.UpdatedAt, &profile.ModerationRole, &profile.HideSensitiveLanguage, &profile.ShowOnline, &profile.PrivateProfile, &profile.ShowBirthDate,
	)
	if err != nil {
		return profile, err
	}
	if birthDate.Valid {
		profile.BirthDate = birthDate.Time.Format("2006-01-02")
	}
	if age.Valid {
		value := int(age.Int64)
		profile.Age = &value
	}
	return profile, nil
}

func (r *PostgresRepository) withDetails(ctx context.Context, profile Profile) (Profile, error) {
	interests, err := loadInterests(ctx, r.db, profile.ID)
	if err != nil {
		return Profile{}, err
	}
	profile.Interests = interests
	profile.Avatars, err = loadProfileAvatars(ctx, r.db, profile.ID)
	if err != nil {
		return Profile{}, err
	}
	return profile, nil
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func loadProfileAvatars(ctx context.Context, q queryer, userID int64) ([]ProfileAvatar, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT
			avatar.media_id,
			'/api/v1/media/' || avatar.media_id::text || '/content',
			avatar.crop_media_id,
			CASE WHEN avatar.crop_media_id IS NULL THEN '' ELSE '/api/v1/media/' || avatar.crop_media_id::text || '/content' END,
			avatar.position,
			CASE WHEN owner.avatar_media_id = avatar.crop_media_id THEN true ELSE false END
		FROM user_profile_avatars avatar
		JOIN media_assets media ON media.id = avatar.media_id
		JOIN users owner ON owner.id = avatar.user_id
		WHERE avatar.user_id = $1
		ORDER BY avatar.position, avatar.created_at, avatar.media_id`, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get profile avatars: %w", err)
	}
	defer func() { _ = rows.Close() }()
	avatars := []ProfileAvatar{}
	for rows.Next() {
		var avatar ProfileAvatar
		var cropID sql.NullInt64
		if err := rows.Scan(&avatar.MediaID, &avatar.URL, &cropID, &avatar.CropURL, &avatar.Position, &avatar.IsPrimary); err != nil {
			return nil, fmt.Errorf("scan profile avatar: %w", err)
		}
		if cropID.Valid {
			value := cropID.Int64
			avatar.CropMediaID = &value
		}
		avatars = append(avatars, avatar)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate profile avatars: %w", err)
	}
	return avatars, nil
}

func loadInterests(ctx context.Context, q queryer, userID int64) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		"SELECT interest FROM user_interests WHERE user_id = $1 ORDER BY position", userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get user interests: %w", err)
	}
	defer func() { _ = rows.Close() }()

	interests := []string{}
	for rows.Next() {
		var interest string
		if err := rows.Scan(&interest); err != nil {
			return nil, fmt.Errorf("scan user interest: %w", err)
		}
		interests = append(interests, interest)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user interests: %w", err)
	}
	return interests, nil
}
