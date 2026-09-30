package events

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type PostgresRepository struct {
	db *sql.DB
}

func (r *PostgresRepository) visibleEventsSQL(alias string) string {
	if alias != "" && alias != "e." {
		panic("unsupported event SQL alias")
	}
	return " AND " + alias + "moderation_hidden_at IS NULL" +
		" AND NOT EXISTS (SELECT 1 FROM users event_creator WHERE event_creator.id = " + alias +
		"created_by_user_id AND event_creator.moderation_suspended_at IS NOT NULL)"
}

func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) checkArtwork(ctx context.Context, ownerID int64, input CreateInput) error {
	for _, mediaID := range []*int64{
		input.HeaderSourceMediaID,
		input.HeaderMediaID,
		input.IconSourceMediaID,
		input.IconMediaID,
	} {
		if mediaID == nil {
			continue
		}
		var ownedImage bool
		if err := r.db.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM media_assets
				WHERE id = $1 AND owner_user_id = $2
					AND moderated_safe
					AND mime_type IN ('image/jpeg', 'image/png')
			)`, *mediaID, ownerID).Scan(&ownedImage); err != nil {
			return fmt.Errorf("validate event artwork: %w", err)
		}
		if !ownedImage {
			return ErrInvalidEvent
		}
	}
	return nil
}

func (r *PostgresRepository) Create(ctx context.Context, record CreateRecord) (Event, error) {
	if err := r.checkArtwork(ctx, record.CreatorID, record.CreateInput); err != nil {
		return Event{}, err
	}

	query := `
		INSERT INTO events (
			created_by_user_id, organizer_name, title, description, category,
			starts_at, ends_at, venue_name, address, city, latitude, longitude,
			source_name, source_url, source_updated_at, ticket_url, price_min_rubles,
			header_source_media_id, header_media_id, icon_source_media_id, icon_media_id,
			organizer_profile_id, is_official, idempotency_key, idempotency_hash
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
		)
		ON CONFLICT (created_by_user_id, idempotency_key)
			WHERE created_by_user_id IS NOT NULL AND idempotency_key IS NOT NULL
		DO NOTHING
		RETURNING ` + eventColumns
	if record.IsOfficial {

		query = `
			INSERT INTO events (
				created_by_user_id, organizer_name, title, description, category,
				starts_at, ends_at, venue_name, address, city, latitude, longitude,
				source_name, source_url, source_updated_at, ticket_url, price_min_rubles,
				header_source_media_id, header_media_id, icon_source_media_id, icon_media_id,
				organizer_profile_id, is_official
			)
			SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, true
			FROM organizer_profiles organizer
			WHERE organizer.id = $22 AND organizer.owner_user_id = $1 AND organizer.status = 'verified'
			RETURNING ` + eventColumns
	}

	args := []any{
		record.CreatorID, record.OrganizerName, record.Title, record.Description, record.Category,
		record.StartsAt, record.EndsAt, record.Location.VenueName, record.Location.Address,
		record.Location.City, record.Location.Latitude, record.Location.Longitude,
		record.Source.Name, record.Source.URL, record.Source.UpdatedAt,
		record.TicketURL, record.PriceMinRubles,
		record.HeaderSourceMediaID, record.HeaderMediaID, record.IconSourceMediaID, record.IconMediaID,
		record.OrganizerProfileID, record.IsOfficial, record.IdempotencyKey, record.IdempotencyHash,
	}
	if record.IsOfficial {
		args = args[:len(args)-3]
	}
	event, err := scanEvent(r.db.QueryRowContext(ctx, query, args...))
	if errors.Is(err, sql.ErrNoRows) && !record.IsOfficial {
		var storedHash []byte
		event, err = scanEventFieldsWithHash(r.db.QueryRowContext(ctx, `
			SELECT `+eventColumns+`, idempotency_hash FROM events
			WHERE created_by_user_id = $1 AND idempotency_key = $2`, record.CreatorID, record.IdempotencyKey), &storedHash)
		if err != nil {
			return Event{}, fmt.Errorf("get idempotent event: %w", err)
		}
		if !bytes.Equal(storedHash, record.IdempotencyHash) {
			return Event{}, ErrIdempotencyConflict
		}
		return event, nil
	}
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) && record.IsOfficial {
			return Event{}, ErrInvalidEvent
		}
		return Event{}, fmt.Errorf("create event: %w", err)
	}
	return event, nil
}

func (r *PostgresRepository) Update(ctx context.Context, userID, eventID int64, input CreateInput, now time.Time) (Event, error) {
	if err := r.checkArtwork(ctx, userID, input); err != nil {
		return Event{}, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, fmt.Errorf("begin event update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	event, err := scanEvent(tx.QueryRowContext(ctx, `UPDATE events SET
		title=$3, description=$4, category=$5, starts_at=$6, ends_at=$7,
		venue_name=$8, address=$9, city=$10, latitude=$11, longitude=$12,
		ticket_url=$13, price_min_rubles=$14,
		header_source_media_id=$15, header_media_id=$16,
		icon_source_media_id=$17, icon_media_id=$18,
		source_updated_at=$19, updated_at=$19
		WHERE id=$1 AND created_by_user_id=$2
		RETURNING `+eventColumns,
		eventID, userID, input.Title, input.Description, input.Category, input.StartsAt, input.EndsAt,
		input.Location.VenueName, input.Location.Address, input.Location.City,
		input.Location.Latitude, input.Location.Longitude, input.TicketURL, input.PriceMinRubles,
		input.HeaderSourceMediaID, input.HeaderMediaID, input.IconSourceMediaID, input.IconMediaID, now))
	if errors.Is(err, sql.ErrNoRows) {
		return Event{}, ErrForbidden
	}
	if err != nil {
		return Event{}, fmt.Errorf("update event: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE background_jobs SET
			run_at = GREATEST($3, $4::timestamptz - interval '24 hours'),
			payload = jsonb_set(payload, '{body}', to_jsonb($2::text), false)
		WHERE kind = 'notification' AND finished_at IS NULL
			AND payload->>'kind' = 'event_reminder'
			AND payload->>'event_id' = $1::bigint::text`,
		eventID, "Не забудьте про мероприятие «"+input.Title+"».", now, input.StartsAt); err != nil {
		return Event{}, fmt.Errorf("reschedule event reminders: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Event{}, fmt.Errorf("commit event update: %w", err)
	}
	return event, nil
}

func (r *PostgresRepository) Delete(ctx context.Context, userID, eventID int64) error {
	var deletedID int64
	err := r.db.QueryRowContext(ctx, `WITH deleted AS (
		DELETE FROM events WHERE id=$1 AND created_by_user_id=$2 RETURNING id
	), jobs AS (
		DELETE FROM background_jobs WHERE payload->>'event_id' = $1::bigint::text
			AND EXISTS (SELECT 1 FROM deleted)
	)
	SELECT id FROM deleted`, eventID, userID).Scan(&deletedID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return fmt.Errorf("delete event: %w", err)
	}
	return nil
}

func scanEventFieldsWithHash(row rowScanner, hash *[]byte) (Event, error) {
	var event Event
	err := scanEventFields(row, &event, hash)
	return event, err
}

func (r *PostgresRepository) List(ctx context.Context, now time.Time, filter Filter, limit int) ([]Event, error) {
	activePromotion := `(e.is_promoted OR EXISTS (
		SELECT 1 FROM event_boosts boost
		WHERE boost.event_id = e.id AND boost.ends_at > $1
	))`
	columns := strings.Replace(
		qualifiedEventColumns,
		"e.is_official, e.is_promoted, e.created_at, e.updated_at",
		"e.is_official, "+activePromotion+" AS is_promoted, e.created_at, e.updated_at",
		1,
	)
	query := `SELECT ` + columns + `
		FROM events e
		WHERE COALESCE(e.ends_at, e.starts_at) >= $1
			AND ($2 = '' OR lower(e.category) = lower($2))
			AND ($3 = '' OR lower(e.city) = lower($3))
			AND ($4::timestamptz IS NULL OR e.starts_at >= $4)
			AND ($5::timestamptz IS NULL OR e.starts_at <= $5)
			AND ($6::bigint IS NULL OR (e.price_min_rubles IS NOT NULL AND e.price_min_rubles <= $6))
			` + r.visibleEventsSQL("e.") + `
		ORDER BY ` + activePromotion + ` DESC, e.starts_at, e.id
		LIMIT $7`
	rows, err := r.db.QueryContext(ctx, query, now, filter.Category, filter.City,
		filter.StartsFrom, filter.StartsTo, filter.PriceMaxRubles, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result := []Event{}
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		result = append(result, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}
	return result, nil
}

func (r *PostgresRepository) Categories(ctx context.Context, now time.Time) ([]Category, error) {
	query := `
		SELECT category, count(*)
		FROM events
		WHERE COALESCE(ends_at, starts_at) >= $1
			` + r.visibleEventsSQL("") + `
		GROUP BY category
		ORDER BY lower(category), category`
	rows, err := r.db.QueryContext(ctx, query, now)
	if err != nil {
		return nil, fmt.Errorf("list event categories: %w", err)
	}
	defer func() { _ = rows.Close() }()

	categories := []Category{}
	for rows.Next() {
		var category Category
		if err := rows.Scan(&category.Name, &category.EventCount); err != nil {
			return nil, fmt.Errorf("scan event category: %w", err)
		}
		categories = append(categories, category)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate event categories: %w", err)
	}
	return categories, nil
}

func (r *PostgresRepository) Get(ctx context.Context, eventID int64) (Event, error) {

	query := `SELECT ` + eventColumns + ` FROM events WHERE id = $1` + r.visibleEventsSQL("")
	event, err := scanEvent(r.db.QueryRowContext(ctx, query, eventID))
	if errors.Is(err, sql.ErrNoRows) {
		return Event{}, ErrNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("get event: %w", err)
	}
	return event, nil
}

const eventColumns = `
	id, title, description, category, starts_at, ends_at,
	venue_name, address, city, latitude, longitude,
	created_by_user_id, organizer_profile_id, organizer_name,
	source_name, source_url, source_updated_at,
	ticket_url, price_min_rubles,
	header_source_media_id, header_media_id, icon_source_media_id, icon_media_id,
	is_official, is_promoted, created_at, updated_at`

const qualifiedEventColumns = `
	e.id, e.title, e.description, e.category, e.starts_at, e.ends_at,
	e.venue_name, e.address, e.city, e.latitude, e.longitude,
	e.created_by_user_id, e.organizer_profile_id, e.organizer_name,
	e.source_name, e.source_url, e.source_updated_at,
	e.ticket_url, e.price_min_rubles,
	e.header_source_media_id, e.header_media_id, e.icon_source_media_id, e.icon_media_id,
	e.is_official, e.is_promoted, e.created_at, e.updated_at`

type rowScanner interface {
	Scan(...any) error
}

func scanEvent(row rowScanner) (Event, error) {
	var event Event
	err := scanEventFields(row, &event)
	return event, err
}

func scanEventFields(row rowScanner, event *Event, additional ...any) error {
	fields := []any{
		&event.ID, &event.Title, &event.Description, &event.Category,
		&event.StartsAt, &event.EndsAt,
		&event.Location.VenueName, &event.Location.Address, &event.Location.City,
		&event.Location.Latitude, &event.Location.Longitude,
		&event.Organizer.UserID, &event.Organizer.ProfileID, &event.Organizer.Name,
		&event.Source.Name, &event.Source.URL, &event.Source.UpdatedAt,
		&event.TicketURL, &event.PriceMinRubles,
		&event.HeaderSourceMediaID, &event.HeaderMediaID, &event.IconSourceMediaID, &event.IconMediaID,
		&event.IsOfficial, &event.IsPromoted,
		&event.CreatedAt, &event.UpdatedAt,
	}
	return row.Scan(append(fields, additional...)...)
}
