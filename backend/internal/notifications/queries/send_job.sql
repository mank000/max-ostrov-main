
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM users
		        WHERE id = $1
		            AND moderation_suspended_at IS NULL
		    )
		    AND (
		        $2::bigint IS NULL
		        OR EXISTS (
		            SELECT
		                1
		            FROM events event
		            WHERE event.id = $2
		                AND event.moderation_hidden_at IS NULL
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM users organizer
		                    WHERE organizer.id = event.created_by_user_id
		                        AND organizer.moderation_suspended_at IS NOT NULL
		                )
		        )
		    )
		    AND (
		        $3::bigint IS NULL
		        OR EXISTS (
		            SELECT
		                1
		            FROM posts
		            WHERE id = $3
		                AND moderation_hidden_at IS NULL
		                AND post_age_visible (posts.id, $1)
		                AND EXISTS (
		                    SELECT
		                        1
		                    FROM users author
		                    WHERE author.id = posts.author_user_id
		                        AND author.moderation_suspended_at IS NULL
		                )
		                AND (
		                    posts.event_id IS NULL
		                    OR EXISTS (
		                        SELECT
		                            1
		                        FROM events parent_event
		                        WHERE parent_event.id = posts.event_id
		                            AND parent_event.moderation_hidden_at IS NULL
		                    )
		                )
		        )
		    )
		    AND (
		        $4::bigint IS NULL
		        OR EXISTS (
		            SELECT
		                1
		            FROM user_gifts
		            WHERE id = $4
		        )
		    )
		    AND (
		        $5::bigint IS NULL
		        OR EXISTS (
		            SELECT
		                1
		            FROM event_groups group_record
		                JOIN events event ON event.id = group_record.event_id
		                AND event.moderation_hidden_at IS NULL
		            WHERE group_record.id = $5
		        )
		    )
		    AND (
		        $6::bigint IS NULL
		        OR EXISTS (
		            SELECT
		                1
		            FROM users
		            WHERE id = $6
		                AND moderation_suspended_at IS NULL
		        )
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM user_blocks block
		        WHERE (
		                block.blocker_id = $1
		                AND block.blocked_id = $6
		            )
		            OR (
		                block.blocker_id = $6
		                AND block.blocked_id = $1
		            )
		    )
		    AND (
		        $7 <> 'event_reminder'
		        OR EXISTS (
		            SELECT
		                1
		            FROM event_participants participant
		                JOIN events event ON event.id = participant.event_id
		            WHERE participant.user_id = $1
		                AND participant.event_id = $2
		                AND COALESCE(event.ends_at, event.starts_at) >= now()
		        )
		    )
		    AND (
		        $7 <> 'event_invitation'
		        OR EXISTS (
		            SELECT
		                1
		            FROM event_invitations invitation
		            WHERE invitation.recipient_id = $1
		                AND invitation.event_id = $2
		                AND invitation.sender_id = $6
		        )
		    )
		    AND (
		        $7 <> 'friend_birthday'
		        OR EXISTS (
		            SELECT
		                1
		            FROM users birthday_friend
		                JOIN friendships friendship ON friendship.user_low_id = LEAST($1::bigint, birthday_friend.id)
		                AND friendship.user_high_id = GREATEST($1::bigint, birthday_friend.id)
		            WHERE birthday_friend.id = $6
		                AND birthday_friend.show_birth_date
		                AND birthday_friend.birth_date IS NOT NULL
		                AND extract(
		                    month
		                    FROM birthday_friend.birth_date
		                ) = extract(
		                    month
		                    FROM current_date
		                )
		                AND extract(
		                    day
		                    FROM birthday_friend.birth_date
		                ) = extract(
		                    day
		                    FROM current_date
		                )
		        )
		    )
