ALTER TABLE post_comments
	DROP CONSTRAINT IF EXISTS post_comments_body_check;

ALTER TABLE post_comments
	ADD CONSTRAINT post_comments_body_check
	CHECK (char_length(body) <= 1000);

CREATE TABLE comment_media (
	comment_id bigint NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
	media_id bigint NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE RESTRICT,
	position smallint NOT NULL CHECK (position BETWEEN 0 AND 3),
	PRIMARY KEY (comment_id, position)
);

CREATE INDEX comment_media_comment_idx
ON comment_media (comment_id, position);
