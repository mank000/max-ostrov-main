package users

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

func (r *PostgresRepository) GetPublic(ctx context.Context, viewerID, targetID int64) (PublicProfileDetails, error) {
	const query = `
		SELECT u.id, u.username, u.display_name, u.bio, u.city,
			CASE WHEN u.birth_date IS NULL THEN NULL ELSE date_part('year', age(current_date, u.birth_date))::integer END,
			CASE WHEN u.show_birth_date AND profile_content_visible($1, u.id) THEN u.birth_date ELSE NULL END,
			u.face_verified_at IS NOT NULL,
			CASE WHEN u.face_verified_at IS NULL THEN 'none' WHEN (u.face_avatar_verified_media_id = u.avatar_media_id OR EXISTS (SELECT 1 FROM user_profile_avatars a WHERE a.user_id = u.id AND u.face_avatar_verified_media_id IN (a.media_id, a.crop_media_id))) THEN 'full' ELSE 'age' END,
			CASE WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content' END,
			COALESCE(u.equipped_decoration_code, ''),
			CASE WHEN u.show_online AND (SELECT viewer.show_online FROM users viewer WHERE viewer.id=$1) THEN u.last_seen_at ELSE NULL END,
			COALESCE(u.show_online AND (SELECT viewer.show_online FROM users viewer WHERE viewer.id=$1) AND u.last_seen_at >= now() - interval '70 seconds', false),
			CASE
				WHEN u.id = $1 THEN 'self'
				WHEN EXISTS (
					SELECT 1 FROM user_blocks block
					WHERE block.blocker_id = $1 AND block.blocked_id = u.id
				) THEN 'blocked'
				WHEN EXISTS (
					SELECT 1 FROM friendships friendship
					WHERE friendship.user_low_id = LEAST($1, u.id)
						AND friendship.user_high_id = GREATEST($1, u.id)
				) THEN 'friend'
				WHEN EXISTS (
					SELECT 1 FROM friend_requests request
					WHERE request.requester_id = $1 AND request.addressee_id = u.id
				) THEN 'outgoing'
				WHEN EXISTS (
					SELECT 1 FROM friend_requests request
					WHERE request.requester_id = u.id AND request.addressee_id = $1
				) THEN 'incoming'
				ELSE 'stranger'
			END,
			COALESCE((
				SELECT jsonb_agg(interest.interest ORDER BY interest.position)
				FROM user_interests interest WHERE interest.user_id = u.id
			), '[]'::jsonb),
			COALESCE((
				SELECT jsonb_agg(target_interest.interest ORDER BY target_interest.position)
				FROM user_interests target_interest
				WHERE target_interest.user_id = u.id AND EXISTS (
					SELECT 1 FROM user_interests viewer_interest
					WHERE viewer_interest.user_id = $1
						AND lower(viewer_interest.interest) = lower(target_interest.interest)
				)
			), '[]'::jsonb),
			(SELECT count(*) FROM friendships friendship
				JOIN users friend_user ON friend_user.id = CASE
					WHEN friendship.user_low_id = u.id THEN friendship.user_high_id
					ELSE friendship.user_low_id END
				WHERE (friendship.user_low_id = u.id OR friendship.user_high_id = u.id)
					AND friend_user.moderation_suspended_at IS NULL
					AND EXISTS (SELECT 1 FROM user_identities identity
						WHERE identity.user_id = friend_user.id AND identity.status = 'verified')
					AND NOT EXISTS (SELECT 1 FROM user_blocks block
						WHERE (block.blocker_id = $1 AND block.blocked_id = u.id)
							OR (block.blocker_id = u.id AND block.blocked_id = $1)
							OR (block.blocker_id = $1 AND block.blocked_id = friend_user.id)
							OR (block.blocker_id = friend_user.id AND block.blocked_id = $1))),
			(SELECT count(*) FROM posts post
			WHERE post.author_user_id = u.id
				AND NOT EXISTS (SELECT 1 FROM clips clip
					WHERE clip.post_id = COALESCE(post.repost_of_post_id, post.id))
				AND post.moderation_hidden_at IS NULL
				AND u.moderation_suspended_at IS NULL
				AND post_age_visible(post.id, $1)
				AND (post.event_id IS NULL OR EXISTS (SELECT 1 FROM events parent_event
					WHERE parent_event.id = post.event_id AND parent_event.moderation_hidden_at IS NULL))
				AND NOT EXISTS (SELECT 1 FROM user_blocks block
					WHERE (block.blocker_id = $1 AND block.blocked_id = u.id)
						OR (block.blocker_id = u.id AND block.blocked_id = $1))
				AND (
					u.id = $1
					OR post.visibility = 'city'
					OR (post.visibility = 'friends' AND EXISTS (
						SELECT 1 FROM friendships friendship
						WHERE friendship.user_low_id = LEAST($1, u.id)
							AND friendship.user_high_id = GREATEST($1, u.id)
					))
				)),
			CASE WHEN u.id = $1 OR u.participant_visibility = 'participants' OR EXISTS (
				SELECT 1 FROM friendships friendship
				WHERE friendship.user_low_id = LEAST($1, u.id)
					AND friendship.user_high_id = GREATEST($1, u.id)
			) THEN (SELECT count(*) FROM events profile_event
				WHERE (profile_event.created_by_user_id = u.id OR EXISTS (SELECT 1 FROM event_participants participant
					WHERE participant.event_id = profile_event.id AND participant.user_id = u.id))
					AND COALESCE(profile_event.ends_at, profile_event.starts_at) >= now()
					AND profile_event.moderation_hidden_at IS NULL
					AND NOT EXISTS (SELECT 1 FROM users event_creator
						WHERE event_creator.id = profile_event.created_by_user_id AND event_creator.moderation_suspended_at IS NOT NULL))
			ELSE 0 END,
			CASE WHEN u.id = $1 OR u.participant_visibility = 'participants' OR EXISTS (
				SELECT 1 FROM friendships friendship
				WHERE friendship.user_low_id = LEAST($1, u.id)
					AND friendship.user_high_id = GREATEST($1, u.id)
			) THEN (SELECT count(*) FROM event_participants target_participant
				JOIN events shared_event ON shared_event.id = target_participant.event_id
				WHERE target_participant.user_id = u.id AND EXISTS (
					SELECT 1 FROM event_participants viewer_participant
					WHERE viewer_participant.user_id = $1
						AND viewer_participant.event_id = target_participant.event_id
				) AND shared_event.moderation_hidden_at IS NULL
					AND NOT EXISTS (SELECT 1 FROM users event_creator WHERE event_creator.id = shared_event.created_by_user_id
						AND event_creator.moderation_suspended_at IS NOT NULL))
			ELSE 0 END,
			u.private_profile,
			NOT profile_content_visible($1,u.id)
		FROM users u
		WHERE u.id = $2
			AND (u.id = $1 OR (u.moderation_suspended_at IS NULL AND EXISTS (
				SELECT 1 FROM user_identities identity
				WHERE identity.user_id = u.id AND identity.status = 'verified'
			)))
			AND NOT EXISTS (
			SELECT 1 FROM user_blocks block
			WHERE block.blocker_id = u.id AND block.blocked_id = $1
		)`

	var profile PublicProfileDetails
	var age sql.NullInt64
	var birthDate sql.NullTime
	var interestsJSON, mutualInterestsJSON []byte
	err := r.db.QueryRowContext(ctx, query, viewerID, targetID).Scan(
		&profile.ID, &profile.Username, &profile.DisplayName, &profile.Bio,
		&profile.City, &age, &birthDate, &profile.FaceVerified, &profile.VerificationTier, &profile.PhotoURL, &profile.EquippedDecorationCode,
		&profile.LastSeenAt, &profile.IsOnline,
		&profile.RelationshipState, &interestsJSON, &mutualInterestsJSON,
		&profile.FriendCount, &profile.PostCount, &profile.EventCount, &profile.CommonEventCount,
		&profile.PrivateProfile, &profile.Restricted,
	)
	if age.Valid {
		value := int(age.Int64)
		profile.Age = &value
	}
	if birthDate.Valid {
		profile.BirthDate = birthDate.Time.Format("2006-01-02")
	}
	if errors.Is(err, sql.ErrNoRows) {
		return PublicProfileDetails{}, ErrNotFound
	}
	if err != nil {
		return PublicProfileDetails{}, fmt.Errorf("get public profile: %w", err)
	}
	if profile.Restricted {
		profile.Username = ""
		profile.Bio = ""
		profile.Age = nil
		profile.BirthDate = ""
		profile.FaceVerified = false
		profile.VerificationTier = "none"
		profile.EquippedDecorationCode = ""
		profile.Interests = []string{}
		profile.MutualInterests = []string{}
		profile.FriendCount = 0
		profile.PostCount = 0
		profile.EventCount = 0
		profile.CommonEventCount = 0
		profile.LastSeenAt = nil
		profile.IsOnline = false
		return profile, nil
	}
	if err := json.Unmarshal(interestsJSON, &profile.Interests); err != nil {
		return PublicProfileDetails{}, fmt.Errorf("decode public profile interests: %w", err)
	}
	if err := json.Unmarshal(mutualInterestsJSON, &profile.MutualInterests); err != nil {
		return PublicProfileDetails{}, fmt.Errorf("decode mutual profile interests: %w", err)
	}
	profile.Avatars, err = loadProfileAvatars(ctx, r.db, targetID)
	if err != nil {
		return PublicProfileDetails{}, err
	}
	return profile, nil
}
