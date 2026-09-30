package events

import (
	"context"
	"fmt"
	"time"
)

func (r *PostgresRepository) Nearby(
	ctx context.Context,
	geo NearbyQuery,
	now time.Time,
	limit int,
) ([]NearbyEvent, error) {
	const distanceExpression = `6371000 * acos(LEAST(1, GREATEST(-1,
		sin(radians($1)) * sin(radians(e.latitude)) +
		cos(radians($1)) * cos(radians(e.latitude)) * cos(radians(e.longitude - $2))
	)))`
	query := `
		SELECT ` + eventColumns + `, round(distance_meters)::bigint
		FROM (
			SELECT ` + qualifiedEventColumns + `, ` + distanceExpression + ` AS distance_meters
			FROM events e
			WHERE e.latitude IS NOT NULL
				AND e.longitude IS NOT NULL
				AND COALESCE(e.ends_at, e.starts_at) >= $3
				` + r.visibleEventsSQL("e.") + `
		) nearby
		WHERE distance_meters <= $4
		ORDER BY distance_meters, starts_at, id
		LIMIT $5`

	rows, err := r.db.QueryContext(ctx, query,
		geo.Latitude, geo.Longitude, now, geo.RadiusMeters, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("find nearby events: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result := []NearbyEvent{}
	for rows.Next() {
		item, err := scanNearbyEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan nearby event: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate nearby events: %w", err)
	}
	return result, nil
}

func (r *PostgresRepository) Viewport(
	ctx context.Context,
	viewport ViewportQuery,
	now time.Time,
	limit int,
) ([]Event, error) {
	query := `SELECT ` + eventColumns + `
		FROM events
		WHERE latitude IS NOT NULL
			AND longitude IS NOT NULL
			AND latitude BETWEEN $1::double precision AND $2::double precision
			AND (($3::double precision <= $4::double precision
					AND longitude BETWEEN $3::double precision AND $4::double precision)
				OR ($3::double precision > $4::double precision
					AND (longitude >= $3::double precision OR longitude <= $4::double precision)))
			AND id > $5::bigint
			AND COALESCE(ends_at, starts_at) >= $6::timestamptz
			` + r.visibleEventsSQL("") + `
		ORDER BY id
		LIMIT $7::bigint`
	rows, err := r.db.QueryContext(ctx, query,
		viewport.South, viewport.North, viewport.West, viewport.East,
		viewport.AfterID, now, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list viewport events: %w", err)
	}
	defer func() { _ = rows.Close() }()

	result := []Event{}
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan viewport event: %w", err)
		}
		result = append(result, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate viewport events: %w", err)
	}
	return result, nil
}
