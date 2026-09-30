package posts

import "fmt"

var postVisibleToViewerSQL = postVisibleToViewerFor("post", "$1")

func postVisibleToViewerFor(alias, viewer string) string {
	return fmt.Sprintf(`(%[1]s.moderation_hidden_at IS NULL
 AND post_age_visible(%[1]s.id,%[2]s)
	AND EXISTS (SELECT 1 FROM users visible_author WHERE visible_author.id = %[1]s.author_user_id
		AND visible_author.moderation_suspended_at IS NULL)
	AND profile_content_visible(%[2]s,%[1]s.author_user_id)
	AND (%[1]s.event_id IS NULL OR EXISTS (SELECT 1 FROM events visible_event
		WHERE visible_event.id = %[1]s.event_id AND visible_event.moderation_hidden_at IS NULL))
	AND (%[1]s.author_user_id = %[2]s
	OR %[1]s.visibility = 'city'
	OR (%[1]s.visibility = 'friends' AND EXISTS (
		SELECT 1 FROM friendships friendship
		WHERE friendship.user_low_id = LEAST(%[2]s, %[1]s.author_user_id)
			AND friendship.user_high_id = GREATEST(%[2]s, %[1]s.author_user_id)
	))
	OR (%[1]s.visibility = 'event' AND %[1]s.event_id IS NOT NULL AND EXISTS (
		SELECT 1 FROM events event
		WHERE event.id = %[1]s.event_id AND (
			event.created_by_user_id = %[2]s OR EXISTS (
				SELECT 1 FROM event_participants participant
				WHERE participant.event_id = %[1]s.event_id AND participant.user_id = %[2]s
			)
		)
	))))`, alias, viewer)
}
