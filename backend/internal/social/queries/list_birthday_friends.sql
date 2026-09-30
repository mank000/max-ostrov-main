
		SELECT
		    u.id,
		    u.username,
		    u.display_name,
		    u.city,
		    CASE
		        WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url
		        ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content'
		    END,
		    u.birth_date,
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
		        WHEN friendship.user_low_id = $1 THEN friendship.user_high_id
		        ELSE friendship.user_low_id
		    END
		WHERE (
		        friendship.user_low_id = $1
		        OR friendship.user_high_id = $1
		    )
		    AND u.moderation_suspended_at IS NULL
		    AND u.show_birth_date
		    AND u.birth_date IS NOT NULL
		    AND extract(
		        month
		        FROM u.birth_date
		    ) = extract(
		        month
		        FROM current_date
		    )
		    AND extract(
		        day
		        FROM u.birth_date
		    ) = extract(
		        day
		        FROM current_date
		    )
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
		                AND block.blocked_id = u.id
		            )
		            OR (
		                block.blocker_id = u.id
		                AND block.blocked_id = $1
		            )
		    )
		ORDER BY
		    lower(u.display_name),
		    u.id
		LIMIT $2
