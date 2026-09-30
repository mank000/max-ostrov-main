package users

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (r *PostgresRepository) Search(
	ctx context.Context,
	userID int64,
	query string,
	limit int,
) ([]PublicProfile, error) {
	const statement = `
		SELECT u.id, CASE WHEN profile_content_visible($1,u.id) THEN u.username ELSE '' END,
			u.display_name, CASE WHEN profile_content_visible($1,u.id) THEN u.bio ELSE '' END, u.city,
			CASE WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content' END,
			CASE WHEN profile_content_visible($1,u.id) THEN COALESCE(u.equipped_decoration_code, '') ELSE '' END,
			CASE
				WHEN EXISTS (
					SELECT 1 FROM friendships friendship
					WHERE friendship.user_low_id = LEAST($1::bigint, u.id)
						AND friendship.user_high_id = GREATEST($1::bigint, u.id)
				) THEN 'friend'
				WHEN EXISTS (
					SELECT 1 FROM friend_requests request
					WHERE request.requester_id = $1 AND request.addressee_id = u.id
				) THEN 'outgoing'
				WHEN EXISTS (
					SELECT 1 FROM friend_requests request
					WHERE request.requester_id = u.id AND request.addressee_id = $1
				) THEN 'incoming'
				ELSE ''
			END,
			COALESCE(jsonb_agg(i.interest ORDER BY i.position)
				FILTER (WHERE i.interest IS NOT NULL AND profile_content_visible($1,u.id)), '[]'::jsonb)
		FROM users u
		LEFT JOIN user_interests i ON i.user_id = u.id
		WHERE u.id <> $1
			AND u.moderation_suspended_at IS NULL
			AND EXISTS (SELECT 1 FROM user_identities identity
				WHERE identity.user_id = u.id AND identity.status = 'verified')
			AND (lower(u.username) LIKE $4 || '%' ESCAPE '\'
				OR lower(u.display_name) LIKE '%' || $4 || '%' ESCAPE '\')
			AND NOT EXISTS (
				SELECT 1 FROM user_blocks b
				WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
					OR (b.blocker_id = u.id AND b.blocked_id = $1)
			)
		GROUP BY u.id
		ORDER BY CASE
				WHEN lower(u.username) = $2 THEN 0
				WHEN lower(u.display_name) = $2 THEN 1
				WHEN lower(u.username) LIKE $4 || '%' ESCAPE '\' THEN 2
				WHEN lower(u.display_name) LIKE $4 || '%' ESCAPE '\' THEN 3
				WHEN lower(u.display_name) LIKE '% ' || $4 || '%' ESCAPE '\' THEN 4
				ELSE 5 END,
			CASE WHEN u.city <> '' AND lower(u.city) = lower((SELECT city FROM users WHERE id = $1)) THEN 0 ELSE 1 END,
			lower(u.display_name), u.id
		LIMIT $3`
	rows, err := r.db.QueryContext(ctx, statement, userID, strings.ToLower(query), limit, strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(query)))
	if err != nil {
		return nil, fmt.Errorf("search users: %w", err)
	}
	defer func() { _ = rows.Close() }()

	profiles := []PublicProfile{}
	for rows.Next() {
		var profile PublicProfile
		var interestsJSON []byte
		if err := rows.Scan(
			&profile.ID, &profile.Username, &profile.DisplayName, &profile.Bio,
			&profile.City, &profile.PhotoURL, &profile.EquippedDecorationCode,
			&profile.FriendRequestStatus, &interestsJSON,
		); err != nil {
			return nil, fmt.Errorf("scan user search result: %w", err)
		}
		if err := json.Unmarshal(interestsJSON, &profile.Interests); err != nil {
			return nil, fmt.Errorf("decode user interests: %w", err)
		}
		profiles = append(profiles, profile)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user search results: %w", err)
	}
	return profiles, nil
}
