
		SELECT
		    g.id,
		    g.event_id,
		    g.leader_user_id,
		    g.title,
		    g.join_policy,
		    g.capacity,
		    CASE
		        WHEN EXISTS (
		            SELECT
		                1
		            FROM group_members own_chat
		            WHERE own_chat.group_id = g.id
		                AND own_chat.user_id = $1
		        ) THEN coalesce(g.chat_provider, '')
		        ELSE ''
		    END AS chat_provider,
		    CASE
		        WHEN EXISTS (
		            SELECT
		                1
		            FROM group_members own_chat
		            WHERE own_chat.group_id = g.id
		                AND own_chat.user_id = $1
		        ) THEN coalesce(g.chat_url, '')
		        ELSE ''
		    END AS chat_url,
		    count(m.user_id)::int AS member_count,
		    (g.capacity - count(m.user_id))::int AS available_places,
		    coalesce(bool_or(m.user_id = $1), false) AS joined,
		    g.leader_user_id = $1 AS is_leader,
		    EXISTS (
		        SELECT
		            1
		        FROM group_join_requests request
		        WHERE request.group_id = g.id
		            AND request.user_id = $1
		    ) AS join_requested,
		    EXISTS (
		        SELECT
		            1
		        FROM group_invitations invitation
		        WHERE invitation.group_id = g.id
		            AND invitation.user_id = $1
		    ) AS invited,
		    EXISTS (
		        SELECT
		            1
		        FROM group_removed_members removed
		        WHERE removed.group_id = g.id
		            AND removed.user_id = $1
		    ) AS reinvite_required,
		    g.created_at,
		    g.updated_at
		FROM event_groups g
		    LEFT JOIN group_members m ON m.group_id = g.id
		WHERE g.event_id = $2
		    AND (
		        EXISTS (
		            SELECT
		                1
		            FROM group_members own
		            WHERE own.group_id = g.id
		                AND own.user_id = $1
		        )
		        OR NOT EXISTS (
		            SELECT
		                1
		            FROM group_members member
		                JOIN user_blocks block ON (
		                    block.blocker_id = $1
		                    AND block.blocked_id = member.user_id
		                )
		                OR (
		                    block.blocker_id = member.user_id
		                    AND block.blocked_id = $1
		                )
		            WHERE member.group_id = g.id
		        )
		    )
		GROUP BY
		    g.id
		ORDER BY
		    g.created_at,
		    g.id
