package notifications

const notificationModerationVisibilitySQL = `
	EXISTS (SELECT 1 FROM users recipient WHERE recipient.id=notification.user_id
		AND recipient.moderation_suspended_at IS NULL)
	AND (notification.actor_user_id IS NULL OR EXISTS (
		SELECT 1 FROM users actor_account WHERE actor_account.id=notification.actor_user_id
			AND actor_account.moderation_suspended_at IS NULL))
	AND (notification.event_id IS NULL OR EXISTS (
		SELECT 1 FROM events event WHERE event.id=notification.event_id
			AND event.moderation_hidden_at IS NULL
			AND NOT EXISTS (SELECT 1 FROM users organizer WHERE organizer.id=event.created_by_user_id
				AND organizer.moderation_suspended_at IS NOT NULL)))
	AND (notification.post_id IS NULL OR EXISTS (
		SELECT 1 FROM posts post JOIN users author ON author.id=post.author_user_id
		WHERE post.id=notification.post_id AND post.moderation_hidden_at IS NULL AND post_age_visible(post.id,notification.user_id)
			AND author.moderation_suspended_at IS NULL
			AND (post.event_id IS NULL OR EXISTS (
				SELECT 1 FROM events event WHERE event.id=post.event_id
					AND event.moderation_hidden_at IS NULL
					AND NOT EXISTS (SELECT 1 FROM users organizer WHERE organizer.id=event.created_by_user_id
						AND organizer.moderation_suspended_at IS NOT NULL)))))
	AND (notification.group_id IS NULL OR EXISTS (
		SELECT 1 FROM event_groups group_record JOIN events event ON event.id=group_record.event_id
		WHERE group_record.id=notification.group_id AND event.moderation_hidden_at IS NULL
			AND NOT EXISTS (SELECT 1 FROM users organizer WHERE organizer.id=event.created_by_user_id
				AND organizer.moderation_suspended_at IS NOT NULL)))`
