package events

import (
	"context"
	"encoding/json"
	"fmt"
)

func (r *PostgresRepository) Participants(
	ctx context.Context,
	userID, eventID int64,
	limit int,
) ([]Participant, error) {
	var eventExists, participating, organizer bool
	if err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM events WHERE id = $1 AND moderation_hidden_at IS NULL),
			EXISTS (SELECT 1 FROM event_participants WHERE event_id = $1 AND user_id = $2),
			EXISTS (SELECT 1 FROM events WHERE id = $1 AND created_by_user_id = $2 AND moderation_hidden_at IS NULL)`,
		eventID, userID,
	).Scan(&eventExists, &participating, &organizer); err != nil {
		return nil, fmt.Errorf("check participant access: %w", err)
	}
	if !eventExists {
		return nil, ErrNotFound
	}
	if !participating && !organizer {
		return nil, ErrParticipationRequired
	}

	const query = `
		WITH attendees AS (
			SELECT ep.user_id FROM event_participants ep WHERE ep.event_id = $2
			UNION
			SELECT event.created_by_user_id FROM events event
			WHERE event.id = $2 AND event.created_by_user_id IS NOT NULL
		)
		SELECT u.id, u.username, u.display_name, u.bio, u.city,
			CASE WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content' END,
			COALESCE(u.equipped_decoration_code, ''),
			COALESCE((
				SELECT jsonb_agg(ui.interest ORDER BY ui.position)
				FROM user_interests ui WHERE ui.user_id = u.id
			), '[]'::jsonb),
			COALESCE((
				SELECT jsonb_agg(ui.interest ORDER BY ui.position)
				FROM user_interests ui
				WHERE ui.user_id = u.id AND EXISTS (
					SELECT 1 FROM user_interests mine
					WHERE mine.user_id = $1 AND lower(mine.interest) = lower(ui.interest)
				)
			), '[]'::jsonb),
			EXISTS (
				SELECT 1 FROM friendships f
				WHERE f.user_low_id = LEAST($1, u.id) AND f.user_high_id = GREATEST($1, u.id)
			) AS is_friend,
			COALESCE(u.id = event.created_by_user_id, false) AS is_organizer,
			gm.group_id
		FROM attendees attendee
		JOIN users u ON u.id = attendee.user_id AND u.moderation_suspended_at IS NULL
		JOIN events event ON event.id = $2 AND event.moderation_hidden_at IS NULL
		LEFT JOIN group_members gm ON gm.user_id = u.id AND gm.event_id = $2
		WHERE (u.id <> $1 OR u.id = event.created_by_user_id)
			AND EXISTS (
				SELECT 1 FROM user_identities identity
				WHERE identity.user_id = u.id AND identity.status = 'verified'
			)
			AND (u.participant_visibility = 'participants' OR u.id = $1)
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks b
				WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
					OR (b.blocker_id = u.id AND b.blocked_id = $1)
			)
		ORDER BY is_organizer DESC, is_friend DESC, array_length(ARRAY(
			SELECT ui.interest FROM user_interests ui
			WHERE ui.user_id = u.id AND EXISTS (
				SELECT 1 FROM user_interests mine
				WHERE mine.user_id = $1 AND lower(mine.interest) = lower(ui.interest)
			)
		), 1) DESC NULLS LAST,
		EXISTS (SELECT 1 FROM profile_boosts boost WHERE boost.user_id=u.id AND boost.ends_at > now()) DESC,
		lower(u.display_name), u.id
		LIMIT $3`
	rows, err := r.db.QueryContext(ctx, query, userID, eventID, limit)
	if err != nil {
		return nil, fmt.Errorf("list event participants: %w", err)
	}
	defer func() { _ = rows.Close() }()

	items := []Participant{}
	for rows.Next() {
		var item Participant
		var interestsJSON, commonJSON []byte
		if err := rows.Scan(
			&item.ID, &item.Username, &item.DisplayName, &item.Bio, &item.City,
			&item.PhotoURL, &item.EquippedDecorationCode, &interestsJSON, &commonJSON, &item.IsFriend, &item.IsOrganizer, &item.GroupID,
		); err != nil {
			return nil, fmt.Errorf("scan event participant: %w", err)
		}
		if err := json.Unmarshal(interestsJSON, &item.Interests); err != nil {
			return nil, fmt.Errorf("decode participant interests: %w", err)
		}
		if err := json.Unmarshal(commonJSON, &item.CommonInterests); err != nil {
			return nil, fmt.Errorf("decode common interests: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate event participants: %w", err)
	}
	return items, nil
}
