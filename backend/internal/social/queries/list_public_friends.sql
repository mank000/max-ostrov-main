
		SELECT
		    u.id,
		    u.username,
		    u.display_name,
		    u.city,
		    CASE
		        WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url
		        ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content'
		    END,
		    CASE
		        WHEN u.show_online
		        AND (
		            SELECT
		                viewer.show_online
		            FROM users viewer
		            WHERE viewer.id = $1
		        ) THEN u.last_seen_at
		        ELSE NULL
		    END,
		    COALESCE(
		        u.show_online
		        AND (
		            SELECT
		                viewer.show_online
		            FROM users viewer
		            WHERE viewer.id = $1
		        )
		        AND u.last_seen_at >= now() - interval '70 seconds',
		        false
		    ),
		    friendship.created_at
		FROM friendships friendship
		    JOIN users u ON u.id = CASE
		        WHEN friendship.user_low_id = $2 THEN friendship.user_high_id
		        ELSE friendship.user_low_id
		    END
		WHERE (
		        friendship.user_low_id = $2
		        OR friendship.user_high_id = $2
		    )
		    AND u.moderation_suspended_at IS NULL
		    AND EXISTS (
		        SELECT
		            1
		        FROM user_identities identity
		        WHERE identity.user_id = u.id
		            AND identity.status = 'verified'
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM user_blocks block
		        WHERE (
		                block.blocker_id = $1
		                AND block.blocked_id = $2
		            )
		            OR (
		                block.blocker_id = $2
		                AND block.blocked_id = $1
		            )
		    )
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM user_blocks block
		        WHERE (
		                block.blocker_id = $1
		                AND block.blocked_id = u.id
		            )
		            OR (
		                block.blocker_id = u.id
		                AND block.blocked_id = $1
		            )
		    )
		    AND (
		        $4::timestamptz IS NULL
		        OR friendship.created_at < $4::timestamptz
		        OR (
		            friendship.created_at = $4::timestamptz
		            AND u.id > $5
		        )
		    )
		ORDER BY
		    friendship.created_at DESC,
		    u.id
		LIMIT $3
