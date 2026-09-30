package events

import (
	"context"
	"fmt"
	"time"
)

func (r *PostgresRepository) Recommendations(
	ctx context.Context,
	userID int64,
	now time.Time,
	limit int,
) ([]Recommendation, error) {
	query := `
		WITH lived_categories AS (
			SELECT lower(category) AS category,LEAST(30,sum(weight)*6) AS affinity FROM (
				SELECT event.category,3 AS weight FROM event_participants participant
				JOIN events event ON event.id=participant.event_id
				WHERE participant.user_id=$1 AND participant.created_at>=now()-interval '180 days'
				UNION ALL
				SELECT event.category,2 AS weight FROM saved_events saved
				JOIN events event ON event.id=saved.event_id
				WHERE saved.user_id=$1 AND saved.created_at>=now()-interval '180 days'
			) action GROUP BY lower(category)
		), ranked AS (
			SELECT ` + qualifiedEventColumns + `,
				COALESCE(lived.affinity,0) AS category_affinity,
				EXISTS (SELECT 1 FROM friendships friend WHERE e.created_by_user_id IS NOT NULL
					AND friend.user_low_id=LEAST($1::bigint,e.created_by_user_id)
					AND friend.user_high_id=GREATEST($1::bigint,e.created_by_user_id)) AS friend_organizer,
				EXISTS (SELECT 1 FROM users viewer WHERE viewer.id=$1
					AND viewer.city<>'' AND lower(viewer.city)=lower(e.city)) AS same_city,
				EXISTS (SELECT 1 FROM event_participants mine
					WHERE mine.event_id=e.id AND mine.user_id=$1) AS already_attending,
				EXISTS (
					SELECT 1 FROM user_interests ui
					WHERE ui.user_id = $1 AND lower(ui.interest) = lower(e.category)
				) AS matches_interest,
				(
					SELECT count(*) FROM event_participants ep
					WHERE ep.event_id = e.id AND EXISTS (
						SELECT 1 FROM user_identities identity
						WHERE identity.user_id = ep.user_id AND identity.status = 'verified'
					)
				) + CASE WHEN e.created_by_user_id IS NOT NULL AND NOT EXISTS (
					SELECT 1 FROM event_participants ep
					WHERE ep.event_id = e.id AND ep.user_id = e.created_by_user_id
				) AND EXISTS (
					SELECT 1 FROM user_identities identity
					WHERE identity.user_id = e.created_by_user_id AND identity.status = 'verified'
				) THEN 1 ELSE 0 END AS participant_count,
				(
					SELECT count(*)
					FROM event_participants ep
					JOIN friendships f ON
						(f.user_low_id = LEAST($1, ep.user_id) AND f.user_high_id = GREATEST($1, ep.user_id))
					WHERE ep.event_id = e.id AND ep.user_id <> $1
						AND EXISTS (
							SELECT 1 FROM user_identities identity
							WHERE identity.user_id = ep.user_id AND identity.status = 'verified'
						)
				) AS friends_attending
			FROM events e LEFT JOIN lived_categories lived ON lived.category=lower(e.category)
			WHERE COALESCE(e.ends_at, e.starts_at) >= $2
				` + r.visibleEventsSQL("e.") + `
		)
		, scored AS (
		SELECT ` + eventColumns + `,
			(category_affinity + LEAST(friends_attending, 4) * 16 +
				 friend_organizer::int * 14 + same_city::int * 5 +
				 CASE WHEN starts_at BETWEEN $2 AND $2+interval '14 days' THEN 8 ELSE 0 END +
				 LEAST(participant_count, 12) + matches_interest::int * 2 -
				 already_attending::int * 30 + (is_promoted OR EXISTS (
					SELECT 1 FROM event_boosts boost WHERE boost.event_id = ranked.id AND boost.ends_at > $2
				 ))::int * 2)::bigint AS score,
			matches_interest, friends_attending, participant_count
		FROM ranked
		), diversified AS (
			SELECT scored.*,
				row_number() OVER (PARTITION BY lower(category)
					ORDER BY score DESC,starts_at,id) AS category_position
			FROM scored
		)
		SELECT ` + eventColumns + `,score,matches_interest,friends_attending,participant_count
		FROM diversified
		ORDER BY ranking_priority(score-LEAST(2,category_position-1)*7,$1,id,'events',$2::date,8) DESC, starts_at, id
		LIMIT $3`
	rows, err := r.db.QueryContext(ctx, query, userID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("recommend events: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items := []Recommendation{}
	for rows.Next() {
		var item Recommendation
		if err := scanEventFields(rows, &item.Event, &item.Score, &item.MatchesInterest,
			&item.FriendsAttending, &item.ParticipantCount); err != nil {
			return nil, fmt.Errorf("scan event recommendation: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate event recommendations: %w", err)
	}
	return items, nil
}
