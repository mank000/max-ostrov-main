
		SELECT
		    u.id,
		    u.username,
		    u.display_name,
		    u.city,
		    CASE
		        WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url
		        ELSE '/api/v1/media/' || u.avatar_media_id::text || '/content'
		    END,
		    COALESCE(
		        (
		            SELECT
		                identity.provider_user_id
		            FROM user_identities identity
		            WHERE identity.user_id = u.id
		                AND identity.provider = 'max'
		                AND identity.status = 'verified'
		        ),
		        0
		    ),
		    COALESCE(
		        (
		            SELECT
		                (viewer.provider_user_id # friend.provider_user_id)::text
		            FROM user_identities viewer
		                JOIN user_identities friend ON friend.user_id = u.id
		            WHERE viewer.user_id = $1
		                AND viewer.provider = 'max'
		                AND viewer.status = 'verified'
		                AND friend.provider = 'max'
		                AND friend.status = 'verified'
		        ),
		        ''
		    ),
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
		    AND EXISTS (
		        SELECT
		            1
		        FROM user_identities identity
		        WHERE identity.user_id = u.id
		            AND identity.status = 'verified'
		    )
		    AND (
		        $3::timestamptz IS NULL
		        OR friendship.created_at < $3::timestamptz
		        OR (
		            friendship.created_at = $3::timestamptz
		            AND u.id > $4
		        )
		    )
		ORDER BY
		    friendship.created_at DESC,
		    u.id
		LIMIT $2
