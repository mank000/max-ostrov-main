UPDATE moderation_reports report
SET target_snapshot = report.target_snapshot || jsonb_build_object(
    'author_user_id', post.author_user_id,
    'author_display_name', author.display_name,
    'author_username', COALESCE(author.username, '')
)
FROM posts post
JOIN users author ON author.id = post.author_user_id
WHERE report.target_type = 'post'
  AND report.target_id = post.id
  AND COALESCE(report.target_snapshot->>'author_display_name', '') = '';
