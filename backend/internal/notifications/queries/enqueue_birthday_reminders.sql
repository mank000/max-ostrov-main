
		WITH
		    pairs AS (
		        SELECT
		            friendship.user_low_id AS user_id,
		            friendship.user_high_id AS actor_user_id
		        FROM friendships friendship
		        UNION ALL
		        SELECT
		            friendship.user_high_id AS user_id,
		            friendship.user_low_id AS actor_user_id
		        FROM friendships friendship
		    ),
		    eligible AS (
		        SELECT
		            pair.user_id,
		            pair.actor_user_id,
		            actor.display_name
		        FROM pairs pair
		            JOIN users recipient ON recipient.id = pair.user_id
		            JOIN users actor ON actor.id = pair.actor_user_id
		        WHERE recipient.moderation_suspended_at IS NULL
		            AND actor.moderation_suspended_at IS NULL
		            AND actor.show_birth_date
		            AND actor.birth_date IS NOT NULL
		            AND extract(
		                month
		                FROM actor.birth_date
		            ) = extract(
		                month
		                FROM current_date
		            )
		            AND extract(
		                day
		                FROM actor.birth_date
		            ) = extract(
		                day
		                FROM current_date
		            )
		            AND EXISTS (
		                SELECT
		                    1
		                FROM user_identities identity
		                WHERE identity.user_id = recipient.id
		                    AND identity.status = 'verified'
		            )
		            AND EXISTS (
		                SELECT
		                    1
		                FROM user_identities identity
		                WHERE identity.user_id = actor.id
		                    AND identity.status = 'verified'
		            )
		            AND NOT EXISTS (
		                SELECT
		                    1
		                FROM user_blocks block
		                WHERE (
		                        block.blocker_id = pair.user_id
		                        AND block.blocked_id = pair.actor_user_id
		                    )
		                    OR (
		                        block.blocker_id = pair.actor_user_id
		                        AND block.blocked_id = pair.user_id
		                    )
		            )
		    )
		INSERT INTO
		    background_jobs (kind, payload, dedupe_key, run_at)
		SELECT
		    'notification',
		    jsonb_build_object(
		        'user_id',
		        user_id,
		        'kind',
		        'friend_birthday',
		        'title',
		        'Сегодня день рождения',
		        'body',
		        'У ' || display_name || ' сегодня день рождения 🎂',
		        'actor_user_id',
		        actor_user_id,
		        'dedupe_key',
		        'friend_birthday:' || user_id::text || ':' || actor_user_id::text || ':' || current_date::text
		    ),
		    'friend_birthday:' || user_id::text || ':' || actor_user_id::text || ':' || current_date::text,
		    now()
		FROM eligible
		ON CONFLICT (dedupe_key) DO NOTHING
