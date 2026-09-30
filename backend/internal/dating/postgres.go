package dating

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"kutezh/backend/internal/notifications"
	domain "kutezh/dating"
)

type Platform interface {
	Changed(...int64)
	Block(context.Context, int64, int64) error
	Report(context.Context, int64, int64, string) error
}

type Repository struct {
	db       *sql.DB
	platform Platform
}

func NewRepository(db *sql.DB, platform Platform) *Repository {
	return &Repository{
		db:       db,
		platform: platform,
	}
}

var _ domain.Repository = (*Repository)(nil)

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

const profileJSON = `COALESCE(p.settings, '{}'::jsonb) || jsonb_build_object(
 'user_id',s.user_id,'name',s.name,'age',s.age,'gender',s.gender,
 'city',s.city,'bio',s.bio,'photo',s.photo,'photos',s.photos,
 'verification_tier',s.verification_tier)`

func readProfile(ctx context.Context, q queryer, id int64) (domain.Profile, bool, error) {
	var raw []byte
	var enabled bool
	err := q.QueryRowContext(ctx, `SELECT `+profileJSON+`,p.user_id IS NOT NULL AND
 (s.age BETWEEN 16 AND 17 OR (s.age>=18 AND COALESCE((p.settings->>'adult_confirmed')::boolean,false)))
 FROM dating_profile_sources s LEFT JOIN dating_profiles p ON p.user_id=s.user_id WHERE s.user_id=$1`, id).Scan(&raw, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Profile{}, false, domain.ErrNotFound
	}
	if err != nil {
		return domain.Profile{}, false, err
	}
	var profile domain.Profile
	if err = json.Unmarshal(raw, &profile); err != nil {
		return profile, false, err
	}
	normalizeProfileAgeRange(&profile)
	if !enabled {
		profile.Goal = "date"
		profile.ShowGender = "all"
		profile.MinAge, profile.MaxAge = defaultDatingAgeRange(profile.Age)
	}
	return profile, enabled, nil
}

func datingAgeRange(age int) (int, int, bool) {
	switch {
	case age >= 16 && age <= 17:
		return 16, 17, true
	case age >= 18 && age <= 100:
		return 18, 100, true
	default:
		return 0, 0, false
	}
}

func defaultDatingAgeRange(age int) (int, int) {
	minAge, maxAge, ok := datingAgeRange(age)
	if !ok {
		return 18, 35
	}
	if maxAge == 17 {
		return minAge, maxAge
	}
	return minAge, 35
}

func normalizeProfileAgeRange(profile *domain.Profile) {
	minAge, maxAge, ok := datingAgeRange(profile.Age)
	if !ok {
		return
	}
	defaultMin, defaultMax := defaultDatingAgeRange(profile.Age)
	if profile.MinAge < minAge || profile.MinAge > maxAge {
		profile.MinAge = defaultMin
	}
	if profile.MaxAge < minAge || profile.MaxAge > maxAge {
		profile.MaxAge = defaultMax
	}
	if profile.MinAge > profile.MaxAge {
		profile.MinAge, profile.MaxAge = defaultMin, defaultMax
	}
}

func validProfileAgeRange(profile domain.Profile, minAge, maxAge int) bool {
	lower, upper, ok := datingAgeRange(profile.Age)
	return ok && minAge >= lower && minAge <= upper &&
		maxAge >= lower && maxAge <= upper && minAge <= maxAge
}

// Совпадения по интересам не должны смешивать взрослую и подростковую выдачу.
func sameAgePool(a, b int) bool {
	aMin, aMax, aOK := datingAgeRange(a)
	bMin, bMax, bOK := datingAgeRange(b)
	return aOK && bOK && aMin == bMin && aMax == bMax
}

func eligible(p domain.Profile) bool {
	_, _, ageOK := datingAgeRange(p.Age)
	return ageOK && (p.Gender == "man" || p.Gender == "woman")
}
func activeProfile(ctx context.Context, q queryer, id int64) (domain.Profile, error) {
	p, enabled, err := readProfile(ctx, q, id)
	if err != nil {
		return p, err
	}
	if !enabled || !eligible(p) {
		return p, domain.ErrProfileNeeded
	}
	return p, nil
}
func (r *Repository) Session(ctx context.Context, id int64) (domain.User, *domain.Profile, *domain.Profile, error) {
	p, enabled, err := readProfile(ctx, r.db, id)
	if err != nil {
		return domain.User{}, nil, nil, err
	}
	source := publicProfile(p)
	u := domain.User{
		ID:       id,
		SourceID: id,
		Name:     p.Name,
	}
	if !enabled || !eligible(p) {
		return u, &source, nil, nil
	}
	u.AdultConfirmedAt = 1
	return u, &source, &p, nil
}
func (r *Repository) GetProfile(ctx context.Context, id int64) (*domain.Profile, error) {
	p, enabled, err := readProfile(ctx, r.db, id)
	if err != nil {
		return nil, err
	}
	if !enabled || !eligible(p) {
		return nil, nil
	}
	return &p, nil
}
func (r *Repository) SaveSettings(ctx context.Context, id int64, s domain.Settings) (domain.Profile, error) {
	p, _, err := readProfile(ctx, r.db, id)
	if err != nil {
		return p, err
	}
	if !eligible(p) {
		return p, domain.ErrForbidden
	}
	if !validProfileAgeRange(p, s.MinAge, s.MaxAge) {
		return p, domain.ErrInvalid
	}
	if p.Age < 18 {
		s.AdultConfirmed = false
	} else if !s.AdultConfirmed {
		return p, domain.ErrForbidden
	}
	if s.SameCityOnly && p.City == "" {
		return p, domain.ErrInvalid
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return p, err
	}
	_, err = r.db.ExecContext(ctx, `
		INSERT INTO
		    dating_profiles (user_id, settings)
		VALUES
		    ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		SET settings = EXCLUDED.settings,
		    updated_at = now()
	`, id, raw)
	if err != nil {
		return p, err
	}
	p, _, err = readProfile(ctx, r.db, id)
	return p, err
}
func (r *Repository) Discover(ctx context.Context, id int64) ([]domain.Profile, error) {
	me, err := activeProfile(ctx, r.db, id)
	if err != nil {
		return nil, err
	}
	out := []domain.Profile{}
	if me.IsPaused {
		return out, nil
	}
	rows, err := r.db.QueryContext(ctx, `
		WITH
		    my_likes AS MATERIALIZED (
		        SELECT
		            swipe.to_id
		        FROM dating_swipes swipe
		            JOIN dating_profile_sources liked ON liked.user_id = swipe.to_id
		        WHERE swipe.from_id = $1
		            AND swipe.kind = 'like'
		            AND (
		                (
		                    liked.age BETWEEN 16 AND 17
		                    AND $5 BETWEEN 16 AND 17
		                )
		                OR (
		                    liked.age >= 18
		                    AND $5 >= 18
		                )
		            )
		        ORDER BY
		            swipe.created_at DESC
		        LIMIT 40
		    ),
		    peers AS MATERIALIZED (
		        SELECT
		            swipe.from_id,
		            count(*) AS overlap
		        FROM my_likes seed
		            JOIN dating_swipes swipe ON swipe.to_id = seed.to_id
		            AND swipe.kind = 'like'
		            JOIN dating_profiles peer ON peer.user_id = swipe.from_id
		            JOIN dating_profile_sources source ON source.user_id = swipe.from_id
		            AND source.age BETWEEN 16 AND 100
		            AND (
		                (
		                    source.age BETWEEN 16 AND 17
		                    AND $5 BETWEEN 16 AND 17
		                )
		                OR (
		                    source.age >= 18
		                    AND $5 >= 18
		                )
		            )
		        WHERE swipe.from_id <> $1
		            AND NOT COALESCE((peer.settings ->> 'is_paused')::boolean, false)
		            AND NOT EXISTS (
		                SELECT
		                    1
		                FROM dating_pair_blocks block
		                WHERE block.from_id = $1
		                    AND block.to_id = swipe.from_id
		            )
		        GROUP BY
		            swipe.from_id
		        HAVING
		            count(*) >= 2
		        ORDER BY
		            overlap DESC,
		            swipe.from_id
		        LIMIT 40
		    ),
		    supported AS (
		        SELECT
		            swipe.to_id,
		            LEAST(24, sum(peers.overlap) * 2) AS strength
		        FROM peers
		            JOIN dating_swipes swipe ON swipe.from_id = peers.from_id
		            AND swipe.kind = 'like'
		        GROUP BY
		            swipe.to_id
		        HAVING
		            count(DISTINCT peers.from_id) >= 3
		    )
		SELECT
	`+profileJSON+`
 FROM dating_profiles p JOIN dating_profile_sources s ON s.user_id=p.user_id
 LEFT JOIN supported support ON support.to_id=s.user_id
 WHERE s.user_id<>$1 AND s.age BETWEEN 16 AND 100 AND s.gender IN ('man','woman')
 AND ((s.age BETWEEN 16 AND 17 AND $5 BETWEEN 16 AND 17)
   OR (s.age>=18 AND $5>=18))
 AND NOT (p.settings->>'is_paused')::boolean
 AND s.age BETWEEN $2 AND $3 AND ($4='all' OR s.gender=$4)
 AND $5 BETWEEN (p.settings->>'min_age')::integer AND (p.settings->>'max_age')::integer
 AND (p.settings->>'show_gender'='all' OR p.settings->>'show_gender'=$6)
 AND (NOT ($7 OR (p.settings->>'same_city_only')::boolean) OR (lower(trim(s.city))=lower(trim($8)) AND trim($8)<>''))
 AND (NOT $10 OR s.verification_tier='full')
 AND NOT EXISTS(SELECT 1 FROM dating_swipes w WHERE w.from_id=$1 AND w.to_id=s.user_id)
 AND NOT EXISTS(SELECT 1 FROM dating_pair_blocks b WHERE b.from_id=$1 AND b.to_id=s.user_id)
 AND NOT EXISTS(SELECT 1 FROM dating_reports r WHERE (r.from_id=$1 AND r.to_id=s.user_id) OR (r.to_id=$1 AND r.from_id=s.user_id))
 ORDER BY
   ranking_priority(CASE WHEN EXISTS(SELECT 1 FROM dating_swipes incoming
      WHERE incoming.from_id=s.user_id AND incoming.to_id=$1 AND incoming.kind='like') THEN 100 ELSE 0 END
    + CASE WHEN p.settings->>'goal'=$9 THEN 16
      WHEN p.settings->>'goal' IN ('date','relationship') AND $9 IN ('date','relationship') THEN 8 ELSE 0 END
    + CASE WHEN EXISTS(SELECT 1 FROM dating_swipes activity
      WHERE activity.from_id=s.user_id AND activity.created_at>=now()-interval '30 days') THEN 5 ELSE 0 END
    + CASE WHEN length(trim(s.bio))>=40 THEN 3 ELSE 0 END
    + CASE s.verification_tier WHEN 'full' THEN 6 WHEN 'age' THEN 2 ELSE 0 END
    + CASE WHEN lower(trim(s.city))=lower(trim($8)) AND trim($8)<>'' THEN 2 ELSE 0 END
    + COALESCE(support.strength,0)
    - LEAST(3,(SELECT count(*) FROM dating_reports report WHERE report.to_id=s.user_id))*12
   ,$1,s.user_id,'dating',current_date,12) DESC
 LIMIT 30`, id, me.MinAge, me.MaxAge, me.ShowGender, me.Age, me.Gender, me.SameCityOnly, me.City, me.Goal, me.VerifiedOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		var p domain.Profile
		if err = rows.Scan(&raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &p); err != nil {
			return nil, err
		}
		out = append(out, publicProfile(p))
	}
	return out, rows.Err()
}
func pairAllowed(ctx context.Context, q queryer, a, b int64) (bool, error) {
	var excluded bool
	err := q.QueryRowContext(ctx, `
		SELECT
		    EXISTS (
		        SELECT
		            1
		        FROM dating_pair_blocks
		        WHERE from_id = $1
		            AND to_id = $2
		    )
		    OR EXISTS (
		        SELECT
		            1
		        FROM dating_reports
		        WHERE (
		                from_id = $1
		                AND to_id = $2
		            )
		            OR (
		                from_id = $2
		                AND to_id = $1
		            )
		    )
	`, a, b).Scan(&excluded)
	return !excluded, err
}
func compatible(a, b domain.Profile) bool {
	return sameAgePool(a.Age, b.Age) &&
		!a.IsPaused && !b.IsPaused && b.Age >= a.MinAge && b.Age <= a.MaxAge && a.Age >= b.MinAge && a.Age <= b.MaxAge &&
		(a.ShowGender == "all" || a.ShowGender == b.Gender) && (b.ShowGender == "all" || b.ShowGender == a.Gender) &&
		(!a.VerifiedOnly || b.VerificationTier == "full") && (!b.VerifiedOnly || a.VerificationTier == "full") &&
		cityAllowed(a, b)
}
func (r *Repository) Swipe(ctx context.Context, id int64, input domain.SwipeInput) (bool, int64, error) {
	if id == input.UserID {
		return false, 0, domain.ErrInvalid
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return false, 0, err
	}
	defer tx.Rollback()

	ids := []int64{id, input.UserID}
	sort.Slice(ids, func(i, j int) bool {
		return ids[i] < ids[j]
	})
	for _, who := range ids {
		var locked int64
		err = tx.QueryRowContext(ctx, `
			SELECT
			    user_id
			FROM dating_profiles
			WHERE user_id = $1
			FOR UPDATE
		`, who).Scan(&locked)
		if errors.Is(err, sql.ErrNoRows) {
			return false, 0, domain.ErrNotFound
		}
		if err != nil {
			return false, 0, err
		}
	}
	me, err := activeProfile(ctx, tx, id)
	if err != nil {
		return false, 0, err
	}
	target, err := activeProfile(ctx, tx, input.UserID)
	if err != nil {
		return false, 0, err
	}
	allowed, err := pairAllowed(ctx, tx, id, input.UserID)
	if err != nil {
		return false, 0, err
	}
	if !allowed || !compatible(me, target) {
		return false, 0, domain.ErrForbidden
	}
	var previous string
	err = tx.QueryRowContext(ctx, `
		SELECT
		    kind
		FROM dating_swipes
		WHERE from_id = $1
		    AND to_id = $2
	`, id, input.UserID).Scan(&previous)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, 0, err
	}
	if err == nil && previous != input.Kind {
		return false, 0, domain.ErrConflict
	}
	swipeResult, err := tx.ExecContext(ctx, `
		INSERT INTO
		    dating_swipes (from_id, to_id, kind)
		VALUES
		    ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, id, input.UserID, input.Kind)
	if err != nil {
		return false, 0, err
	}
	swipeRows, err := swipeResult.RowsAffected()
	if err != nil {
		return false, 0, err
	}
	var matched bool
	err = tx.QueryRowContext(ctx, `
		SELECT
		    $3 = 'like'
		    AND EXISTS (
		        SELECT
		            1
		        FROM dating_swipes
		        WHERE from_id = $2
		            AND to_id = $1
		            AND kind = 'like'
		    )
	`, id, input.UserID, input.Kind).Scan(&matched)
	if err != nil {
		return false, 0, err
	}
	var matchID int64
	created := false
	if matched {
		err = tx.QueryRowContext(ctx, `
			INSERT INTO
			    dating_matches (a_id, b_id)
			VALUES
			    ($1, $2)
			ON CONFLICT DO NOTHING
			RETURNING id
		`, ids[0], ids[1]).Scan(&matchID)
		if errors.Is(err, sql.ErrNoRows) {
			err = tx.QueryRowContext(ctx, `
				SELECT
				    id
				FROM dating_matches
				WHERE a_id = $1
				    AND b_id = $2
			`, ids[0], ids[1]).Scan(&matchID)
		} else if err == nil {
			created = true
		}
		if err != nil {
			return false, 0, err
		}
		if created {

			if _, err = tx.ExecContext(ctx, `
				UPDATE notifications
				SET read_at = COALESCE(read_at, now())
				WHERE user_id = $1
				    AND kind = 'dating_like'
				    AND dedupe_key = $2
			`,
				id, fmt.Sprintf("dating_like:%d:%d", input.UserID, id)); err != nil {
				return false, 0, err
			}
			var notificationID int64
			err = tx.QueryRowContext(ctx, `
				INSERT INTO
				    notifications (user_id, kind, title, body, actor_user_id, dedupe_key)
				VALUES
				    (
				        $1,
				        'dating_match',
				        'Взаимная симпатия',
				        'Вы понравились друг другу. Теперь вы друзья и можете написать друг другу.',
				        $2,
				        $3
				    )
				ON CONFLICT (user_id, dedupe_key) DO NOTHING
				RETURNING id
			`,
				input.UserID, id, fmt.Sprintf("dating_match:%d", matchID)).Scan(&notificationID)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return false, 0, err
			}
			if err == nil {
				if err = notifications.EnqueueBotDelivery(ctx, tx, notificationID); err != nil {
					return false, 0, err
				}
			}
		}
	}
	if swipeRows == 1 && input.Kind == "like" && !matched {
		var notificationID int64
		err = tx.QueryRowContext(ctx, `
			INSERT INTO
			    notifications (user_id, kind, title, body, dedupe_key)
			VALUES
			    (
			        $1,
			        'dating_like',
			        'Новая симпатия',
			        'Кто-то лайкнул вашу анкету.',
			        $2
			    )
			ON CONFLICT (user_id, dedupe_key) DO UPDATE
			SET actor_user_id = NULL,
			    read_at = NULL,
			    created_at = now()
			RETURNING id
		`, input.UserID, fmt.Sprintf("dating_like:%d:%d", id, input.UserID)).Scan(&notificationID)
		if err != nil {
			return false, 0, err
		}
		if err = notifications.EnqueueBotDelivery(ctx, tx, notificationID); err != nil {
			return false, 0, err
		}
	}
	if err = tx.Commit(); err != nil {
		return false, 0, err
	}
	if r.platform != nil && (created || swipeRows == 1 && input.Kind == "like") {
		r.platform.Changed(id, input.UserID)
		if notifier, ok := r.platform.(interface{ Notified(...int64) }); ok {
			notifier.Notified(id, input.UserID)
		}
	}
	return created, matchID, nil
}
func (r *Repository) Matches(ctx context.Context, id int64) ([]domain.Match, error) {
	me, err := activeProfile(ctx, r.db, id)
	if err != nil {
		return nil, err
	}
	out := []domain.Match{}
	if me.IsPaused {
		return out, nil
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT
		    m.id,
	`+profileJSON+` FROM dating_matches m
 JOIN dating_profiles p ON p.user_id=CASE WHEN m.a_id=$1 THEN m.b_id ELSE m.a_id END
 JOIN dating_profile_sources s ON s.user_id=p.user_id
 WHERE (m.a_id=$1 OR m.b_id=$1) AND s.age BETWEEN 16 AND 100 AND s.gender IN ('man','woman')
 AND ((s.age BETWEEN 16 AND 17 AND $2 BETWEEN 16 AND 17)
   OR (s.age>=18 AND $2>=18))
 AND NOT (p.settings->>'is_paused')::boolean
 AND NOT EXISTS(SELECT 1 FROM dating_pair_blocks b WHERE b.from_id=$1 AND b.to_id=s.user_id)
 AND NOT EXISTS(SELECT 1 FROM dating_reports r WHERE (r.from_id=$1 AND r.to_id=s.user_id) OR (r.to_id=$1 AND r.from_id=s.user_id))
 ORDER BY m.id DESC`, id, me.Age)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		var m domain.Match
		if err = rows.Scan(&m.MatchID, &raw); err != nil {
			return nil, err
		}
		if err = json.Unmarshal(raw, &m.Profile); err != nil {
			return nil, err
		}
		m.Profile = publicProfile(m.Profile)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repository) WeeklyStats(ctx context.Context, id int64) (domain.WeeklyStats, error) {
	me, err := activeProfile(ctx, r.db, id)
	if err != nil {
		return domain.WeeklyStats{}, err
	}
	var stats domain.WeeklyStats
	err = r.db.QueryRowContext(ctx, `
		SELECT
		    (
		        SELECT
		            count(*)
		        FROM dating_matches dm
		            JOIN dating_profile_sources peer ON peer.user_id = CASE
		                WHEN dm.a_id = $1 THEN dm.b_id
		                ELSE dm.a_id
		            END
		        WHERE (
		                dm.a_id = $1
		                OR dm.b_id = $1
		            )
		            AND dm.created_at >= now() - interval '7 days'
		            AND (
		                (
		                    peer.age BETWEEN 16 AND 17
		                    AND $2 BETWEEN 16 AND 17
		                )
		                OR (
		                    peer.age >= 18
		                    AND $2 >= 18
		                )
		            )
		    ),
		    (
		        SELECT
		            count(*)
		        FROM dating_swipes swipe
		            JOIN dating_profile_sources peer ON peer.user_id = swipe.to_id
		        WHERE swipe.from_id = $1
		            AND swipe.kind = 'like'
		            AND swipe.created_at >= now() - interval '7 days'
		            AND (
		                (
		                    peer.age BETWEEN 16 AND 17
		                    AND $2 BETWEEN 16 AND 17
		                )
		                OR (
		                    peer.age >= 18
		                    AND $2 >= 18
		                )
		            )
		    ),
		    (
		        SELECT
		            count(*)
		        FROM dating_swipes swipe
		            JOIN dating_profile_sources peer ON peer.user_id = swipe.from_id
		        WHERE swipe.to_id = $1
		            AND swipe.kind = 'like'
		            AND swipe.created_at >= now() - interval '7 days'
		            AND (
		                (
		                    peer.age BETWEEN 16 AND 17
		                    AND $2 BETWEEN 16 AND 17
		                )
		                OR (
		                    peer.age >= 18
		                    AND $2 >= 18
		                )
		            )
		    )
	`, id, me.Age).
		Scan(&stats.Matches, &stats.LikedByMe, &stats.LikedMe)
	return stats, err
}

func (r *Repository) Unmatch(ctx context.Context, userID, matchID int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()
	var a, b int64
	err = tx.QueryRowContext(ctx, `
		DELETE FROM dating_matches
		WHERE id = $1
		    AND (
		        a_id = $2
		        OR b_id = $2
		    )
		RETURNING a_id,
		    b_id
	`, matchID, userID).Scan(&a, &b)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	other := a
	if other == userID {
		other = b
	}
	if _, err = tx.ExecContext(ctx, `
		DELETE FROM dating_swipes
		WHERE from_id = $1
		    AND to_id = $2
		    AND kind = 'like'
	`, userID, other); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if r.platform != nil {
		r.platform.Changed(userID, other)
	}
	return nil
}
func (r *Repository) MatchOther(ctx context.Context, matchID, id int64) (int64, error) {
	a, b, err := r.MatchSourceIDs(ctx, matchID)
	if err != nil {
		return 0, err
	}
	if id != a && id != b {
		return 0, domain.ErrNotFound
	}
	other := a
	if other == id {
		other = b
	}
	me, err := activeProfile(ctx, r.db, id)
	if err != nil || me.IsPaused {
		return 0, domain.ErrForbidden
	}
	target, err := activeProfile(ctx, r.db, other)
	if err != nil || target.IsPaused || !sameAgePool(me.Age, target.Age) {
		return 0, domain.ErrForbidden
	}
	allowed, err := pairAllowed(ctx, r.db, id, other)
	if err != nil {
		return 0, err
	}
	if !allowed {
		return 0, domain.ErrForbidden
	}
	return other, nil
}
func (r *Repository) MatchSourceIDs(ctx context.Context, id int64) (int64, int64, error) {
	var a, b int64
	err := r.db.QueryRowContext(ctx, `
		SELECT
		    a_id,
		    b_id
		FROM dating_matches
		WHERE id = $1
	`, id).Scan(&a, &b)
	if errors.Is(err, sql.ErrNoRows) {
		err = domain.ErrNotFound
	}
	return a, b, err
}
func (r *Repository) UserSourceID(ctx context.Context, id int64) (int64, error) {
	_, _, err := readProfile(ctx, r.db, id)
	return id, err
}
func (r *Repository) Block(ctx context.Context, id, other int64) error {
	me, err := activeProfile(ctx, r.db, id)
	if err != nil {
		return err
	}
	target, err := activeProfile(ctx, r.db, other)
	if err != nil {
		return err
	}
	if !sameAgePool(me.Age, target.Age) {
		return domain.ErrForbidden
	}
	err = r.platform.Block(ctx, id, other)
	if err == nil {
		r.platform.Changed(id, other)
	}
	return err
}
func (r *Repository) Report(ctx context.Context, id int64, input domain.ReportInput) error {
	me, err := activeProfile(ctx, r.db, id)
	if err != nil {
		return err
	}
	target, err := activeProfile(ctx, r.db, input.UserID)
	if err != nil {
		return err
	}
	if !sameAgePool(me.Age, target.Age) {
		return domain.ErrForbidden
	}
	if err := r.platform.Report(ctx, id, input.UserID, input.Reason); err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `
		INSERT INTO
		    dating_reports (from_id, to_id)
		VALUES
		    ($1, $2)
		ON CONFLICT DO NOTHING
	`, id, input.UserID)
	if err == nil {
		r.platform.Changed(id, input.UserID)
	}
	return err
}
func (r *Repository) DeleteUser(ctx context.Context, id int64) error {

	_, err := r.db.ExecContext(ctx, `
		DELETE FROM dating_profiles
		WHERE user_id = $1
	`, id)
	return err
}

func publicProfile(p domain.Profile) domain.Profile {
	p.ShowGender = ""
	p.MinAge = 0
	p.MaxAge = 0
	p.SameCityOnly = false
	p.VerifiedOnly = false
	p.IsPaused = false
	return p
}

func cityAllowed(a, b domain.Profile) bool {
	if !a.SameCityOnly && !b.SameCityOnly {
		return true
	}
	left := strings.ToLower(strings.TrimSpace(a.City))
	return left != "" && left == strings.ToLower(strings.TrimSpace(b.City))
}
