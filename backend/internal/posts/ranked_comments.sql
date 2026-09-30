-- Свои ветки и ветки с нашим ответом идут первыми независимо от лайков.
WITH RECURSIVE
    roots AS (
        SELECT
            comment.id,
            comment.author_user_id,
            comment.created_at,
            (comment.author_user_id = $1) AS is_mine,
            EXISTS (
                SELECT
                    1
                FROM post_comments reply
                WHERE reply.parent_comment_id = comment.id
                    AND reply.author_user_id = $1
                    AND reply.moderation_hidden_at IS NULL
                    AND comment_safety_visible (reply.id, $1)
            ) AS has_my_reply,
            EXISTS (
                SELECT
                    1
                FROM friendships friend
                WHERE friend.user_low_id = LEAST($1::bigint, comment.author_user_id)
                    AND friend.user_high_id = GREATEST($1::bigint, comment.author_user_id)
            ) AS is_friend,
            EXISTS (
                SELECT
                    1
                FROM comment_likes mine
                WHERE mine.comment_id = comment.id
                    AND mine.user_id = $1
            ) AS liked_by_me,
            EXISTS (
                SELECT
                    1
                FROM post_comments reply
                WHERE reply.parent_comment_id = comment.id
                    AND reply.reply_to_user_id = $1
                    AND reply.moderation_hidden_at IS NULL
                    AND comment_safety_visible (reply.id, $1)
            ) AS addresses_me,
            EXISTS (
                SELECT
                    1
                FROM post_comments reply
                    JOIN posts post ON post.id = $2
                WHERE reply.parent_comment_id = comment.id
                    AND reply.author_user_id = post.author_user_id
                    AND reply.moderation_hidden_at IS NULL
                    AND comment_safety_visible (reply.id, $1)
            ) AS author_replied,
            LEAST(
                3,
                (
                    SELECT
                        count(DISTINCT reply.author_user_id)
                    FROM post_comments reply
                    WHERE reply.parent_comment_id = comment.id
                        AND reply.moderation_hidden_at IS NULL
                        AND comment_safety_visible (reply.id, $1)
                        AND EXISTS (
                            SELECT
                                1
                            FROM user_identities identity
                            WHERE identity.user_id = reply.author_user_id
                                AND identity.status = 'verified'
                        )
                )
            ) AS voices,
            LEAST(
                10,
                (
                    SELECT
                        count(*)
                    FROM comment_likes likes
                    WHERE likes.comment_id = comment.id
                        AND EXISTS (
                            SELECT
                                1
                            FROM user_identities identity
                            WHERE identity.user_id = likes.user_id
                                AND identity.status = 'verified'
                        )
                )
            ) AS verified_likes
        FROM post_comments comment
            JOIN users author ON author.id = comment.author_user_id
        WHERE comment.post_id = $2
            AND comment.parent_comment_id IS NULL
            AND comment.moderation_hidden_at IS NULL
            AND comment_safety_visible (comment.id, $1)
            AND author.moderation_suspended_at IS NULL
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
    ),
    scored AS (
        SELECT
            roots.*,
            CASE
                WHEN is_mine THEN 0
                WHEN has_my_reply THEN 1
                ELSE 2
            END AS personal_order,
            CASE
                WHEN addresses_me THEN 65
                ELSE 0
            END + CASE
                WHEN liked_by_me THEN 30
                ELSE 0
            END + CASE
                WHEN is_friend THEN 24
                ELSE 0
            END + CASE
                WHEN author_replied THEN 24
                ELSE 0
            END + voices * 8 + verified_likes + CASE
                WHEN created_at >= now() - interval '1 day' THEN 14
                WHEN created_at >= now() - interval '7 days' THEN 6
                ELSE 0
            END AS score
        FROM roots
    ),
    fair AS (
        SELECT
            scored.*,
            row_number() OVER (
                PARTITION BY
                    author_user_id
                ORDER BY
                    personal_order,
                    score DESC,
                    created_at DESC,
                    id DESC
            ) AS author_position
        FROM scored
    ),
    ordered_roots AS (
        SELECT
            fair.id,
            row_number() OVER (
                ORDER BY
                    CASE
                        WHEN is_mine THEN 0
                        WHEN has_my_reply THEN 1
                        WHEN author_position <= 2 THEN 2
                        ELSE 3
                    END,
                    score DESC,
                    created_at DESC,
                    id DESC
            ) AS root_position
        FROM fair
    ),
    tree AS (
        SELECT
            root.id AS id,
            root.root_position,
            0 AS depth
        FROM ordered_roots root
        UNION ALL
        SELECT
            child.id,
            tree.root_position,
            tree.depth + 1
        FROM tree
            JOIN post_comments child ON child.parent_comment_id = tree.id
            AND child.post_id = $2
            JOIN users author ON author.id = child.author_user_id
        WHERE child.moderation_hidden_at IS NULL
            AND comment_safety_visible (child.id, $1)
            AND author.moderation_suspended_at IS NULL
            AND NOT EXISTS (
                SELECT
                    1
                FROM user_blocks block
                WHERE (
                        block.blocker_id = $1
                        AND block.blocked_id = child.author_user_id
                    )
                    OR (
                        block.blocker_id = child.author_user_id
                        AND block.blocked_id = $1
                    )
            )
    ),
    ordered AS (
        SELECT
            comment.id,
            row_number() OVER (
                ORDER BY
                    tree.root_position,
                    tree.depth,
                    CASE
                        WHEN comment.reply_to_user_id = $1 THEN 0
                        WHEN comment.author_user_id = $1 THEN 1
                        WHEN comment.author_user_id = post.author_user_id THEN 2
                        ELSE 3
                    END,
                    comment.created_at,
                    comment.id
            ) - 1 AS position
        FROM tree
            JOIN post_comments
        comment ON comment.id = tree.id
        JOIN posts post ON post.id = $2
    )
INSERT INTO
    ranked_comment_items (snapshot_id, position, comment_id)
SELECT
    $3,
    position,
    id
FROM ordered
WHERE position < 5000
