package users

import (
	"context"
	"database/sql"
	"errors"
)

type AvatarLiker struct {
	ID          int64  `json:"id"`
	DisplayName string `json:"display_name"`
	PhotoURL    string `json:"photo_url"`
}
type AvatarLikes struct {
	Count int           `json:"count"`
	Liked bool          `json:"liked"`
	Users []AvatarLiker `json:"users"`
	Next  int64         `json:"next,omitempty"`
}
type avatarLikesRepository interface {
	AvatarLikes(context.Context, int64, int64, int64, int64, *bool) (AvatarLikes, error)
}

func (s *Service) AvatarLikes(ctx context.Context, viewer, owner, media, after int64, like *bool) (AvatarLikes, error) {
	if viewer <= 0 || owner <= 0 || media < 0 || after < 0 {
		return AvatarLikes{}, ErrInvalidAvatar
	}
	repo, ok := s.repository.(avatarLikesRepository)
	if !ok {
		return AvatarLikes{}, ErrInvalidAvatar
	}
	return repo.AvatarLikes(ctx, viewer, owner, media, after, like)
}
func (r *PostgresRepository) AvatarLikes(ctx context.Context, viewer, owner, media, after int64, like *bool) (AvatarLikes, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AvatarLikes{}, err
	}
	defer tx.Rollback()
	// Lock the owner while checking the source and changing reactions. Avatar
	// editing takes the same lock; posts and arbitrary media cannot be liked here.
	var id int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM users WHERE id=$1 AND moderation_suspended_at IS NULL FOR UPDATE`, owner).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return AvatarLikes{}, ErrNotFound
	}
	if err != nil {
		return AvatarLikes{}, err
	}
	var allowed bool
	err = tx.QueryRowContext(ctx, `SELECT
 NOT EXISTS(SELECT 1 FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1))
 AND profile_content_visible($1,$2)
 AND EXISTS(SELECT 1 FROM users WHERE id=$1 AND moderation_suspended_at IS NULL AND onboarding_version>=1)
 AND (($3=0 AND NOT EXISTS(SELECT 1 FROM user_profile_avatars WHERE user_id=$2))
 OR EXISTS(SELECT 1 FROM user_profile_avatars WHERE user_id=$2 AND media_id=$3))`, viewer, owner, media).Scan(&allowed)
	if err != nil {
		return AvatarLikes{}, err
	}
	if !allowed {
		return AvatarLikes{}, ErrNotFound
	}
	if like != nil {
		if *like {
			_, err = tx.ExecContext(ctx, `INSERT INTO avatar_likes(owner_user_id,avatar_key,media_id,user_id) VALUES($1,$2,NULLIF($2::bigint,0),$3) ON CONFLICT DO NOTHING`, owner, media, viewer)
		} else {
			_, err = tx.ExecContext(ctx, `DELETE FROM avatar_likes WHERE owner_user_id=$1 AND avatar_key=$2 AND user_id=$3`, owner, media, viewer)
		}
		if err != nil {
			return AvatarLikes{}, err
		}
	}
	result := AvatarLikes{Users: []AvatarLiker{}}
	const visible = ` FROM avatar_likes l JOIN users u ON u.id=l.user_id WHERE l.owner_user_id=$1 AND l.avatar_key=$2 AND u.moderation_suspended_at IS NULL AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=$3 AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=$3))`
	err = tx.QueryRowContext(ctx, `SELECT count(*),COALESCE(bool_or(l.user_id=$3),false)`+visible, owner, media, viewer).Scan(&result.Count, &result.Liked)
	if err != nil {
		return AvatarLikes{}, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT u.id,u.display_name,CASE WHEN u.avatar_media_id IS NULL THEN u.provider_photo_url ELSE '/api/v1/media/'||u.avatar_media_id::text||'/content' END`+visible+` AND u.id>$4 ORDER BY u.id LIMIT 101`, owner, media, viewer, after)
	if err != nil {
		return AvatarLikes{}, err
	}
	for rows.Next() {
		var u AvatarLiker
		if err = rows.Scan(&u.ID, &u.DisplayName, &u.PhotoURL); err != nil {
			rows.Close()
			return AvatarLikes{}, err
		}
		result.Users = append(result.Users, u)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return AvatarLikes{}, err
	}
	if len(result.Users) > 100 {
		result.Users = result.Users[:100]
		result.Next = result.Users[99].ID
	}
	if err = tx.Commit(); err != nil {
		return AvatarLikes{}, err
	}
	return result, nil
}
