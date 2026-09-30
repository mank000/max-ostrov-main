
		SELECT
		    media.id,
		    media.storage_key,
		    media.mime_type,
		    media.byte_size,
		    media.width,
		    media.height,
		    media.duration_ms,
		    media.created_at
		FROM media_assets media
		WHERE media.id = $2
		    AND EXISTS (
		        SELECT
		            1
		        FROM users viewer
		        WHERE viewer.id = $1
		            AND viewer.moderation_suspended_at IS NULL
		    )
		    AND (
		        media.owner_user_id = $1
		        OR EXISTS (
		            SELECT
		                1
		            FROM users avatar_owner
		            WHERE avatar_owner.avatar_media_id = media.id
		                AND avatar_owner.moderation_suspended_at IS NULL
		                AND avatar_owner.onboarding_version >= 1
		                AND EXISTS (
		                    SELECT
		                        1
		                    FROM user_identities identity
		                    WHERE identity.user_id = avatar_owner.id
		                        AND identity.status = 'verified'
		                )
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM user_blocks block
		                    WHERE (
		                            block.blocker_id = $1
		                            AND block.blocked_id = avatar_owner.id
		                        )
		                        OR (
		                            block.blocker_id = avatar_owner.id
		                            AND block.blocked_id = $1
		                        )
		                )
		        )
		        OR EXISTS (
		            SELECT
		                1
		            FROM user_profile_avatars gallery
		                JOIN users avatar_owner ON avatar_owner.id = gallery.user_id
		            WHERE (
		                    gallery.media_id = media.id
		                    OR gallery.crop_media_id = media.id
		                )
		                AND profile_content_visible ($1, avatar_owner.id)
		                AND avatar_owner.moderation_suspended_at IS NULL
		                AND avatar_owner.onboarding_version >= 1
		                AND EXISTS (
		                    SELECT
		                        1
		                    FROM user_identities identity
		                    WHERE identity.user_id = avatar_owner.id
		                        AND identity.status = 'verified'
		                )
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM user_blocks block
		                    WHERE (
		                            block.blocker_id = $1
		                            AND block.blocked_id = avatar_owner.id
		                        )
		                        OR (
		                            block.blocker_id = avatar_owner.id
		                            AND block.blocked_id = $1
		                        )
		                )
		        )
		        OR EXISTS (
		            SELECT
		                1
		            FROM events event
		            WHERE (
		                    media.id IN (event.header_media_id, event.icon_media_id)
		                    OR (
		                        event.created_by_user_id = $1
		                        AND media.id IN (event.header_source_media_id, event.icon_source_media_id)
		                    )
		                )
		                AND event.moderation_hidden_at IS NULL
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM users event_owner
		                    WHERE event_owner.id = event.created_by_user_id
		                        AND event_owner.moderation_suspended_at IS NOT NULL
		                )
		        )
		        OR EXISTS (
		            SELECT
		                1
		            FROM post_media link
		                JOIN posts post ON post.id = link.post_id
		            WHERE link.media_id = media.id
		                AND profile_content_visible ($1, post.author_user_id)
		                AND post.moderation_hidden_at IS NULL
		                AND post_age_visible (post.id, $1)
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM users author
		                    WHERE author.id = post.author_user_id
		                        AND author.moderation_suspended_at IS NOT NULL
		                )
		                AND (
		                    post.event_id IS NULL
		                    OR EXISTS (
		                        SELECT
		                            1
		                        FROM events parent_event
		                        WHERE parent_event.id = post.event_id
		                            AND parent_event.moderation_hidden_at IS NULL
		                    )
		                )
		                AND (
		                    post.author_user_id = $1
		                    OR post.visibility = 'city'
		                    OR (
		                        post.visibility = 'friends'
		                        AND EXISTS (
		                            SELECT
		                                1
		                            FROM friendships friendship
		                            WHERE friendship.user_low_id = LEAST($1, post.author_user_id)
		                                AND friendship.user_high_id = GREATEST($1, post.author_user_id)
		                        )
		                    )
		                    OR (
		                        post.visibility = 'event'
		                        AND post.event_id IS NOT NULL
		                        AND EXISTS (
		                            SELECT
		                                1
		                            FROM events event
		                            WHERE event.id = post.event_id
		                                AND event.moderation_hidden_at IS NULL
		                                AND (
		                                    event.created_by_user_id = $1
		                                    OR EXISTS (
		                                        SELECT
		                                            1
		                                        FROM event_participants participant
		                                        WHERE participant.event_id = post.event_id
		                                            AND participant.user_id = $1
		                                    )
		                                )
		                        )
		                    )
		                )
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM user_blocks block
		                    WHERE (
		                            block.blocker_id = $1
		                            AND block.blocked_id = post.author_user_id
		                        )
		                        OR (
		                            block.blocker_id = post.author_user_id
		                            AND block.blocked_id = $1
		                        )
		                )
		        )
		        OR EXISTS (
		            SELECT
		                1
		            FROM comment_media link
		                JOIN post_comments
		            comment ON comment.id = link.comment_id
		            JOIN posts post ON post.id = comment.post_id
		            WHERE link.media_id = media.id
		                AND profile_content_visible ($1, post.author_user_id)
		                AND comment.moderation_hidden_at IS NULL
		                AND comment_safety_visible (comment.id, $1)
		                AND post.moderation_hidden_at IS NULL
		                AND post_age_visible (post.id, $1)
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM users author
		                    WHERE author.id IN (post.author_user_id, comment.author_user_id)
		                        AND author.moderation_suspended_at IS NOT NULL
		                )
		                AND (
		                    post.event_id IS NULL
		                    OR EXISTS (
		                        SELECT
		                            1
		                        FROM events parent_event
		                        WHERE parent_event.id = post.event_id
		                            AND parent_event.moderation_hidden_at IS NULL
		                    )
		                )
		                AND (
		                    post.author_user_id = $1
		                    OR post.visibility = 'city'
		                    OR (
		                        post.visibility = 'friends'
		                        AND EXISTS (
		                            SELECT
		                                1
		                            FROM friendships friendship
		                            WHERE friendship.user_low_id = LEAST($1, post.author_user_id)
		                                AND friendship.user_high_id = GREATEST($1, post.author_user_id)
		                        )
		                    )
		                    OR (
		                        post.visibility = 'event'
		                        AND post.event_id IS NOT NULL
		                        AND EXISTS (
		                            SELECT
		                                1
		                            FROM events event
		                            WHERE event.id = post.event_id
		                                AND event.moderation_hidden_at IS NULL
		                                AND (
		                                    event.created_by_user_id = $1
		                                    OR EXISTS (
		                                        SELECT
		                                            1
		                                        FROM event_participants participant
		                                        WHERE participant.event_id = post.event_id
		                                            AND participant.user_id = $1
		                                    )
		                                )
		                        )
		                    )
		                )
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM user_blocks block
		                    WHERE (
		                            block.blocker_id = $1
		                            AND block.blocked_id = post.author_user_id
		                        )
		                        OR (
		                            block.blocker_id = post.author_user_id
		                            AND block.blocked_id = $1
		                        )
		                )
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM user_blocks block
		                    WHERE (
		                            block.blocker_id = $1
		                            AND block.blocked_id = comment.author_user_id
		                        )
		                        OR (
		                            block.blocker_id = comment.author_user_id
		                            AND block.blocked_id = $1
		                        )
		                )
		        )
		        OR EXISTS (
		            SELECT
		                1
		            FROM attendance_media link
		                JOIN events event ON event.id = link.event_id
		            WHERE link.media_id = media.id
		                AND event.moderation_hidden_at IS NULL
		                AND NOT EXISTS (
		                    SELECT
		                        1
		                    FROM users evidence_owner
		                    WHERE evidence_owner.id = link.user_id
		                        AND evidence_owner.moderation_suspended_at IS NOT NULL
		                )
		                AND (
		                    link.user_id = $1
		                    OR event.created_by_user_id = $1
		                )
		        )
		        OR EXISTS (
		            SELECT
		                1
		            FROM support_message_media support_link
		                JOIN support_messages support_message ON support_message.id = support_link.message_id
		                JOIN support_threads support_thread ON support_thread.id = support_message.thread_id
		                JOIN user_identities support_identity ON support_identity.provider = 'max'
		                AND support_identity.provider_user_id = support_thread.provider_user_id
		                AND support_identity.status = 'verified'
		            WHERE support_link.media_id = media.id
		                AND support_identity.user_id = $1
		        )
		    )
