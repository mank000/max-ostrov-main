
		SELECT
		    comment.id,
		    comment.post_id,
		    comment.parent_comment_id,
		    comment.body,
		    (
		        SELECT
		            count(*)
		        FROM comment_likes likes
		        WHERE likes.comment_id = comment.id
		    ),
		    EXISTS (
		        SELECT
		            1
		        FROM comment_likes likes
		        WHERE likes.comment_id = comment.id
		            AND likes.user_id = $1
		    ),
		    comment.created_at,
		    jsonb_build_object(
		        'id',
		        author.id,
		        'username',
		        author.username,
		        'display_name',
		        author.display_name,
		        'photo_url',
		        CASE
		            WHEN author.avatar_media_id IS NULL THEN author.provider_photo_url
		            ELSE '/api/v1/media/' || author.avatar_media_id::text || '/content'
		        END,
		        'equipped_decoration_code',
		        author.equipped_decoration_code
		    ),
		    CASE
		        WHEN reply_to.id IS NULL THEN NULL
		        ELSE jsonb_build_object(
		            'id',
		            reply_to.id,
		            'username',
		            reply_to.username,
		            'display_name',
		            reply_to.display_name,
		            'photo_url',
		            CASE
		                WHEN reply_to.avatar_media_id IS NULL THEN reply_to.provider_photo_url
		                ELSE '/api/v1/media/' || reply_to.avatar_media_id::text || '/content'
		            END,
		            'equipped_decoration_code',
		            reply_to.equipped_decoration_code
		        )
		    END,
		    COALESCE(
		        (
		            SELECT
		                jsonb_agg(
		                    jsonb_build_object(
		                        'id',
		                        media.id,
		                        'mime_type',
		                        media.mime_type,
		                        'width',
		                        media.width,
		                        'height',
		                        media.height,
		                        'duration_ms',
		                        media.duration_ms,
		                        'url',
		                        '/api/v1/media/' || media.id::text || '/content'
		                    )
		                    ORDER BY
		                        link.position
		                )
		            FROM comment_media link
		                JOIN media_assets media ON media.id = link.media_id
		            WHERE link.comment_id = comment.id
		        ),
		        '[]'::jsonb
		    )
		FROM post_comments comment
		    JOIN users author ON author.id = comment.author_user_id
		    AND author.moderation_suspended_at IS NULL
		    LEFT JOIN users reply_to ON reply_to.id = comment.reply_to_user_id
		    AND NOT EXISTS (
		        SELECT
		            1
		        FROM user_blocks reply_block
		        WHERE (
		                reply_block.blocker_id = $1
		                AND reply_block.blocked_id = reply_to.id
		            )
		            OR (
		                reply_block.blocker_id = reply_to.id
		                AND reply_block.blocked_id = $1
		            )
		    )
		WHERE comment.post_id = $2
		    AND comment.moderation_hidden_at IS NULL
		    AND comment_safety_visible (comment.id, $1)
		    AND (
		        NOT $5::boolean
		        OR comment.id = ANY ($6::bigint[])
		    )
		    AND (
		        $3::bigint = 0
		        OR comment.id < $3
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
		ORDER BY
		    comment.id DESC
		LIMIT $4
