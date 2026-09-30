package organizers

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

type PostgresRepository struct {
	db *sql.DB
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) Create(ctx context.Context, userID int64, input Input, now time.Time) (Profile, error) {
	profile, err := scanProfile(r.db.QueryRowContext(ctx, `
		INSERT INTO organizer_profiles (owner_user_id, name, description, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $4)
		RETURNING `+profileColumns, userID, input.Name, input.Description, now))
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			return Profile{}, ErrAlreadyExists
		}
		return Profile{}, fmt.Errorf("create organizer profile: %w", err)
	}
	return profile, nil
}

func (r *PostgresRepository) ListOwned(ctx context.Context, userID int64) ([]Profile, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT `+profileColumns+`
		FROM organizer_profiles
		WHERE owner_user_id = $1
		ORDER BY created_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := []Profile{}
	for rows.Next() {
		item, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) Get(ctx context.Context, id int64) (Profile, error) {
	profile, err := scanProfile(r.db.QueryRowContext(ctx, `
		SELECT `+profileColumns+`
		FROM organizer_profiles
		WHERE id = $1 AND status = 'verified'
	`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	return profile, nil
}

func (r *PostgresRepository) ListForReview(ctx context.Context, reviewerID int64, status Status) ([]Profile, error) {
	allowed, err := r.isReviewer(ctx, reviewerID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrForbidden
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT `+profileColumns+`
		FROM organizer_profiles
		WHERE status = $1
		ORDER BY created_at, id
	`, status)
	if err != nil {
		return nil, fmt.Errorf("list organizer reviews: %w", err)
	}
	defer func() { _ = rows.Close() }()
	items := []Profile{}
	for rows.Next() {
		item, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepository) Update(ctx context.Context, userID, id int64, input Input, now time.Time) (Profile, error) {
	profile, err := scanProfile(r.db.QueryRowContext(ctx, `
		UPDATE organizer_profiles
		SET name = $3, description = $4, status = 'pending',
			reviewed_by_user_id = NULL, reviewed_at = NULL, updated_at = $5
		WHERE id = $1 AND owner_user_id = $2
		RETURNING `+profileColumns, id, userID, input.Name, input.Description, now))
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	return profile, nil
}

func (r *PostgresRepository) Review(ctx context.Context, reviewerID, id int64, status Status, now time.Time) (Profile, error) {
	allowed, err := r.isReviewer(ctx, reviewerID)
	if err != nil {
		return Profile{}, err
	}
	if !allowed {
		return Profile{}, ErrForbidden
	}
	profile, err := scanProfile(r.db.QueryRowContext(ctx, `
		UPDATE organizer_profiles
		SET status = $3, reviewed_by_user_id = $1, reviewed_at = $4, updated_at = $4
		WHERE id = $2
		RETURNING `+profileColumns, reviewerID, id, status, now))
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	return profile, nil
}

func (r *PostgresRepository) isReviewer(ctx context.Context, userID int64) (bool, error) {
	var allowed bool
	err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_roles
			WHERE user_id = $1 AND role IN ('moderator', 'administrator')
		)
	`, userID).Scan(&allowed)
	if err != nil {
		return false, fmt.Errorf("check organizer reviewer role: %w", err)
	}
	return allowed, nil
}

func (r *PostgresRepository) VerifiedOwned(ctx context.Context, userID, id int64) (Profile, error) {
	profile, err := scanProfile(r.db.QueryRowContext(ctx, `
		SELECT `+profileColumns+`
		FROM organizer_profiles
		WHERE id = $1 AND owner_user_id = $2
	`, id, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Profile{}, ErrNotFound
	}
	if err != nil {
		return Profile{}, err
	}
	if profile.Status != StatusVerified {
		return Profile{}, ErrNotVerified
	}
	return profile, nil
}

const profileColumns = `id, owner_user_id, name, description, status, reviewed_by_user_id, reviewed_at, created_at, updated_at`

type scanner interface{ Scan(...any) error }

func scanProfile(row scanner) (Profile, error) {
	var profile Profile
	err := row.Scan(
		&profile.ID, &profile.OwnerUserID, &profile.Name, &profile.Description,
		&profile.Status, &profile.ReviewedByUserID, &profile.ReviewedAt,
		&profile.CreatedAt, &profile.UpdatedAt,
	)
	return profile, err
}
