package dating

import (
	"context"
	"database/sql"
	"errors"
	domain "kutezh/dating"
	"sort"
)

// Undo only rewinds a user's latest unpaired decision. It never silently removes
// an established match or the shared friendship created from it.
func (r *Repository) Undo(ctx context.Context, id, targetID int64) (domain.Profile, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Profile{}, err
	}
	defer tx.Rollback()
	ids := []int64{id, targetID}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, who := range ids {
		var locked int64
		if err = tx.QueryRowContext(ctx, `SELECT user_id FROM dating_profiles WHERE user_id=$1 FOR UPDATE`, who).Scan(&locked); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return domain.Profile{}, domain.ErrNotFound
			}
			return domain.Profile{}, err
		}
	}
	me, err := activeProfile(ctx, tx, id)
	if err != nil {
		return domain.Profile{}, err
	}
	target, err := activeProfile(ctx, tx, targetID)
	if err != nil {
		return domain.Profile{}, err
	}
	allowed, err := pairAllowed(ctx, tx, id, targetID)
	if err != nil {
		return domain.Profile{}, err
	}
	if !allowed || !compatible(me, target) {
		return domain.Profile{}, domain.ErrForbidden
	}
	var matched bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dating_matches WHERE a_id=$1 AND b_id=$2)`, ids[0], ids[1]).Scan(&matched); err != nil {
		return domain.Profile{}, err
	}
	if matched {
		return domain.Profile{}, domain.ErrConflict
	}
	var latest int64
	err = tx.QueryRowContext(ctx, `SELECT to_id FROM dating_swipes WHERE from_id=$1 ORDER BY created_at DESC,to_id DESC LIMIT 1`, id).Scan(&latest)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return domain.Profile{}, err
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dating_swipes WHERE from_id=$1 AND to_id=$2)`, id, targetID).Scan(&exists); err != nil {
		return domain.Profile{}, err
	}
	if exists && latest != targetID {
		return domain.Profile{}, domain.ErrConflict
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM dating_swipes WHERE from_id=$1 AND to_id=$2`, id, targetID); err != nil {
		return domain.Profile{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.Profile{}, err
	}
	r.platform.Changed(id)
	return publicProfile(target), nil
}
