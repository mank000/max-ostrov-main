package users

import (
	"context"
	"encoding/json"
	"fmt"
)

func (r *PostgresRepository) Suggestions(ctx context.Context, viewerID int64, limit int) ([]Suggestion, error) {
	const statement = `
		WITH viewer AS (
			SELECT city FROM users WHERE id = $1
		), event_candidates AS (
			SELECT DISTINCT other.user_id AS id
			FROM event_participants mine
			JOIN event_participants other ON other.event_id = mine.event_id
			JOIN users target ON target.id = other.user_id
			JOIN events event ON event.id = mine.event_id
			WHERE mine.user_id = $1 AND other.user_id <> $1
				AND target.participant_visibility = 'participants'
				AND event.moderation_hidden_at IS NULL
				AND event.starts_at >= now() - interval '90 days'
			ORDER BY other.user_id LIMIT 200
		), friend_candidates AS (
			SELECT DISTINCT CASE WHEN second.user_low_id = first.peer_id
				THEN second.user_high_id ELSE second.user_low_id END AS id
			FROM (
				SELECT CASE WHEN user_low_id = $1 THEN user_high_id ELSE user_low_id END AS peer_id
				FROM friendships WHERE user_low_id = $1 OR user_high_id = $1
			) first
			JOIN friendships second ON second.user_low_id = first.peer_id OR second.user_high_id = first.peer_id
			ORDER BY id LIMIT 200
		), interest_candidates AS (
			SELECT DISTINCT target.user_id AS id
			FROM user_interests mine
			JOIN user_interests target ON lower(target.interest) = lower(mine.interest)
			WHERE mine.user_id = $1 AND target.user_id <> $1
			ORDER BY target.user_id LIMIT 200
		), city_candidates AS (
			SELECT target.id FROM users target, viewer
			WHERE viewer.city <> '' AND lower(target.city) = lower(viewer.city)
				AND target.id <> $1
			ORDER BY target.id LIMIT 200
		), recent_candidates AS (
			SELECT identity.user_id AS id
			FROM user_identities identity
			WHERE identity.status = 'verified' AND identity.user_id <> $1
			ORDER BY identity.created_at DESC, identity.user_id DESC LIMIT 100
		), candidate_ids AS (
			SELECT id FROM event_candidates UNION SELECT id FROM friend_candidates
			UNION SELECT id FROM interest_candidates UNION SELECT id FROM city_candidates
			UNION SELECT id FROM recent_candidates
		), eligible AS (
			SELECT target.* FROM candidate_ids candidate
			JOIN users target ON target.id = candidate.id
			WHERE target.id <> $1 AND target.moderation_suspended_at IS NULL
				AND EXISTS (SELECT 1 FROM user_identities identity
					WHERE identity.user_id = target.id AND identity.status = 'verified')
				AND NOT EXISTS (SELECT 1 FROM friendships friendship
					WHERE friendship.user_low_id = LEAST($1::bigint, target.id)
						AND friendship.user_high_id = GREATEST($1::bigint, target.id))
				AND NOT EXISTS (SELECT 1 FROM friend_requests request
					WHERE (request.requester_id = $1 AND request.addressee_id = target.id)
						OR (request.requester_id = target.id AND request.addressee_id = $1))
				AND NOT EXISTS (SELECT 1 FROM user_blocks block
					WHERE (block.blocker_id = $1 AND block.blocked_id = target.id)
						OR (block.blocker_id = target.id AND block.blocked_id = $1))
		), signals AS (
			SELECT target.*,
				CASE WHEN target.participant_visibility = 'participants' THEN (
					SELECT count(*) FROM event_participants mine
					JOIN event_participants other ON other.event_id = mine.event_id
					JOIN events event ON event.id = mine.event_id
					WHERE mine.user_id = $1 AND other.user_id = target.id
						AND event.moderation_hidden_at IS NULL
						AND event.starts_at >= now() - interval '90 days'
				) ELSE 0 END AS shared_events,
				(SELECT count(*) FROM friendships first
					WHERE (first.user_low_id = $1 OR first.user_high_id = $1)
						AND EXISTS (SELECT 1 FROM friendships second
							WHERE second.user_low_id = LEAST(target.id,
								CASE WHEN first.user_low_id = $1 THEN first.user_high_id ELSE first.user_low_id END)
							AND second.user_high_id = GREATEST(target.id,
								CASE WHEN first.user_low_id = $1 THEN first.user_high_id ELSE first.user_low_id END))
						AND EXISTS (SELECT 1 FROM user_identities identity
							WHERE identity.user_id = CASE WHEN first.user_low_id = $1 THEN first.user_high_id ELSE first.user_low_id END
							AND identity.status = 'verified')
						AND EXISTS (SELECT 1 FROM users peer
							WHERE peer.id = CASE WHEN first.user_low_id = $1 THEN first.user_high_id ELSE first.user_low_id END
							AND peer.moderation_suspended_at IS NULL)) AS mutual_friends,
				(SELECT count(*) FROM user_interests mine
					JOIN user_interests other ON lower(other.interest) = lower(mine.interest)
					WHERE mine.user_id = $1 AND other.user_id = target.id) AS shared_interests,
				(target.city <> '' AND lower(target.city) = lower((SELECT city FROM viewer))) AS same_city
			FROM eligible target
		), ranked AS (
			SELECT signals.*,
				LEAST(shared_events, 3) * 40 + LEAST(mutual_friends, 5) * 18
					+ LEAST(shared_interests, 5) * 8 + CASE WHEN same_city THEN 4 ELSE 0 END
					+ CASE WHEN created_at >= now() - interval '30 days' THEN 2 ELSE 0 END AS score,
				CASE WHEN shared_events > 0 THEN 'shared_event'
					WHEN mutual_friends > 0 THEN 'mutual_friend'
					WHEN shared_interests > 0 THEN 'shared_interest'
					WHEN same_city THEN 'same_city' ELSE 'new_member' END AS reason_code
			FROM signals
		), diversified AS (
			SELECT ranked.*,
				row_number() OVER (PARTITION BY reason_code ORDER BY score DESC, created_at DESC, id) AS reason_position
			FROM ranked
		)
		SELECT id, CASE WHEN profile_content_visible($1,id) THEN username ELSE '' END,
			display_name, CASE WHEN profile_content_visible($1,id) THEN bio ELSE '' END, city,
			CASE WHEN avatar_media_id IS NULL THEN provider_photo_url
				ELSE '/api/v1/media/' || avatar_media_id::text || '/content' END,
			CASE WHEN profile_content_visible($1,id) THEN COALESCE(equipped_decoration_code, '') ELSE '' END,
			CASE WHEN profile_content_visible($1,id) THEN COALESCE((SELECT jsonb_agg(interest.interest ORDER BY interest.position)
				FROM user_interests interest WHERE interest.user_id = diversified.id), '[]'::jsonb) ELSE '[]'::jsonb END,
			reason_code,
			CASE WHEN NOT profile_content_visible($1,id) THEN 'Закрытый профиль' ELSE CASE reason_code
				WHEN 'shared_event' THEN 'У вас есть общее мероприятие'
				WHEN 'mutual_friend' THEN 'У вас есть общие друзья'
				WHEN 'shared_interest' THEN 'У вас есть общие интересы'
				WHEN 'same_city' THEN 'Вы из одного города'
				ELSE 'Новый участник' END END
		FROM diversified
		ORDER BY (reason_position - 1) / 4,
			ranking_priority(score,$1,id,'people',current_date,18) DESC, created_at DESC, id
		LIMIT $2`
	rows, err := r.db.QueryContext(ctx, statement, viewerID, limit)
	if err != nil {
		return nil, fmt.Errorf("suggest users: %w", err)
	}
	defer func() { _ = rows.Close() }()
	suggestions := []Suggestion{}
	for rows.Next() {
		var suggestion Suggestion
		var interestsJSON []byte
		if err := rows.Scan(&suggestion.ID, &suggestion.Username, &suggestion.DisplayName,
			&suggestion.Bio, &suggestion.City, &suggestion.PhotoURL,
			&suggestion.EquippedDecorationCode, &interestsJSON,
			&suggestion.ReasonCode, &suggestion.Reason); err != nil {
			return nil, fmt.Errorf("scan user suggestion: %w", err)
		}
		if err := json.Unmarshal(interestsJSON, &suggestion.Interests); err != nil {
			return nil, fmt.Errorf("decode user suggestion interests: %w", err)
		}
		suggestions = append(suggestions, suggestion)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user suggestions: %w", err)
	}
	return suggestions, nil
}
