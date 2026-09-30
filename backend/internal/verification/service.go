package verification

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"kutezh/backend/internal/media"
)

const maxAgeDelta = 10

var (
	ErrNotAllowed        = errors.New("face verification unavailable")
	ErrBirthDateRequired = errors.New("birth date required")
	ErrNoFace            = errors.New("face not found")
	ErrMultipleFaces     = errors.New("multiple faces found")
	ErrAgeMismatch       = errors.New("age mismatch")
	ErrInvalidImage      = errors.New("face image rejected")
	ErrUnavailable       = errors.New("face ai unavailable")
)

type Service struct {
	db     *sql.DB
	url    string
	client *http.Client
	media  *media.Service
}

type Result struct {
	EstimatedAge int        `json:"estimated_age"`
	ProfileAge   int        `json:"profile_age"`
	AgeDelta     int        `json:"age_delta"`
	FaceScore    float64    `json:"face_score"`
	CheckedAt    time.Time  `json:"checked_at"`
	VerifiedAt   *time.Time `json:"verified_at,omitempty"`
	Tier         string     `json:"verification_tier"`
}

type aiResponse struct {
	FaceCount               int     `json:"face_count"`
	Age                     float64 `json:"age"`
	FaceScore               float64 `json:"face_score"`
	AvatarMatch             bool    `json:"avatar_match"`
	AvatarComparisonEnabled *bool   `json:"avatar_comparison_enabled"`
}

func NewService(db *sql.DB, url string, mediaService ...*media.Service) *Service {
	service := &Service{db: db, url: url, client: &http.Client{Timeout: 20 * time.Second}}
	if len(mediaService) > 0 {
		service.media = mediaService[0]
	}
	return service
}

func (s *Service) Verify(ctx context.Context, userID int64, image []byte) (Result, error) {
	var birthDate sql.NullTime
	var avatarID sql.NullInt64
	if err := s.db.QueryRowContext(ctx, `
		SELECT birth_date, avatar_media_id FROM users WHERE id = $1`, userID).Scan(&birthDate, &avatarID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Result{}, ErrNotAllowed
		}
		return Result{}, fmt.Errorf("load verification profile: %w", err)
	}
	if !birthDate.Valid {
		return Result{}, ErrBirthDateRequired
	}
	analysis, matchedAvatarID, err := s.analyzeAvatars(ctx, userID, avatarID, image)
	if err != nil {
		return Result{}, err
	}
	if analysis.FaceCount == 0 {
		return Result{}, ErrNoFace
	}
	if analysis.FaceCount != 1 {
		return Result{}, ErrMultipleFaces
	}
	if math.IsNaN(analysis.FaceScore) || math.IsInf(analysis.FaceScore, 0) || analysis.FaceScore < 0.9 || analysis.FaceScore > 1 || math.IsNaN(analysis.Age) || math.IsInf(analysis.Age, 0) || analysis.Age < 0 || analysis.Age > 100 {
		return Result{}, ErrUnavailable
	}
	profileAge := ageAt(time.Now().UTC(), birthDate.Time)
	estimatedAge := int(math.Round(analysis.Age))
	delta := estimatedAge - profileAge
	if delta < 0 {
		delta = -delta
	}
	accepted := delta <= maxAgeDelta
	var checkedAt time.Time
	var verifiedAt sql.NullTime
	var tier string
	if err := s.db.QueryRowContext(ctx, `
		UPDATE users SET
			face_last_estimated_age = $2,
			face_last_profile_age = $3,
			face_last_age_delta = $4,
			face_last_score = $5,
			face_last_checked_at = now(),
			face_verified_at = CASE WHEN $6 THEN now() ELSE NULL END,
			face_avatar_verified_media_id = CASE WHEN $6 AND $7::bigint IS NOT NULL AND
				($7::bigint = avatar_media_id OR EXISTS (
					SELECT 1 FROM user_profile_avatars a WHERE a.user_id = users.id
						AND $7::bigint IN (a.media_id, a.crop_media_id)
				)) THEN $7::bigint ELSE NULL END,
			updated_at = now()
		WHERE id = $1 AND birth_date = $8
		RETURNING face_last_checked_at, face_verified_at,
			CASE WHEN face_verified_at IS NULL THEN 'none'
			WHEN face_avatar_verified_media_id = avatar_media_id OR EXISTS (
				SELECT 1 FROM user_profile_avatars a WHERE a.user_id = users.id
					AND face_avatar_verified_media_id IN (a.media_id, a.crop_media_id)
			) THEN 'full'
			ELSE 'age' END`,
		userID, estimatedAge, profileAge, delta, analysis.FaceScore, accepted,
		matchedAvatarID, birthDate.Time,
	).Scan(&checkedAt, &verifiedAt, &tier); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Result{}, ErrNotAllowed
		}
		return Result{}, fmt.Errorf("save face verification result: %w", err)
	}
	result := Result{
		EstimatedAge: estimatedAge,
		ProfileAge:   profileAge,
		AgeDelta:     delta,
		FaceScore:    analysis.FaceScore,
		CheckedAt:    checkedAt,
		Tier:         tier,
	}
	if verifiedAt.Valid {
		value := verifiedAt.Time
		result.VerifiedAt = &value
	}
	if !accepted {
		return result, ErrAgeMismatch
	}
	return result, nil
}

func (s *Service) analyzeAvatars(ctx context.Context, userID int64, primary sql.NullInt64, image []byte) (aiResponse, sql.NullInt64, error) {
	ids := make([]int64, 0, 12)
	seen := make(map[int64]bool)
	add := func(id int64) {
		if id > 0 && !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	if primary.Valid {
		add(primary.Int64)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT media_id, crop_media_id
		FROM user_profile_avatars WHERE user_id=$1 ORDER BY position, created_at, media_id`, userID)
	if err != nil {
		return aiResponse{}, sql.NullInt64{}, fmt.Errorf("load profile photos: %w", err)
	}
	for rows.Next() {
		var source int64
		var crop sql.NullInt64
		if err = rows.Scan(&source, &crop); err != nil {
			_ = rows.Close()
			return aiResponse{}, sql.NullInt64{}, fmt.Errorf("scan profile photo: %w", err)
		}
		if crop.Valid {
			add(crop.Int64)
		}
		add(source)
	}
	if err = rows.Err(); err != nil {
		_ = rows.Close()
		return aiResponse{}, sql.NullInt64{}, fmt.Errorf("list profile photos: %w", err)
	}
	_ = rows.Close()
	var analysis aiResponse
	gotAnalysis := false
	if s.media != nil && len(image) <= 10<<20 {
		for _, id := range ids {
			asset, file, openErr := s.media.Open(ctx, userID, id)
			if openErr != nil {
				continue
			}
			if asset.ByteSize < 1024 || asset.ByteSize > 10<<20 {
				_ = file.Close()
				continue
			}
			avatar, readErr := io.ReadAll(io.LimitReader(file, (10<<20)+1))
			_ = file.Close()
			if readErr != nil || len(avatar) < 1024 || len(avatar) > 10<<20 {
				continue
			}
			body := make([]byte, 4+len(image)+len(avatar))
			binary.BigEndian.PutUint32(body[:4], uint32(len(image)))
			copy(body[4:], image)
			copy(body[4+len(image):], avatar)
			result, pairErr := s.analyze(ctx, body, "application/x-kutezh-face-pair")
			if pairErr != nil {
				continue
			}
			analysis, gotAnalysis = result, true
			if result.AvatarMatch {
				return analysis, sql.NullInt64{Int64: id, Valid: true}, nil
			}
			if result.FaceCount != 1 || (result.AvatarComparisonEnabled != nil && !*result.AvatarComparisonEnabled) {
				break
			}
		}
	}
	if gotAnalysis {
		return analysis, sql.NullInt64{}, nil
	}
	analysis, err = s.analyze(ctx, image, "application/octet-stream")
	return analysis, sql.NullInt64{}, err
}

func (s *Service) analyze(ctx context.Context, body []byte, contentType string) (aiResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return aiResponse{}, fmt.Errorf("create face ai request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := s.client.Do(req)
	if err != nil {
		return aiResponse{}, ErrUnavailable
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		if resp.StatusCode == http.StatusUnprocessableEntity || resp.StatusCode == http.StatusBadRequest {
			return aiResponse{}, ErrInvalidImage
		}
		return aiResponse{}, ErrUnavailable
	}
	var analysis aiResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&analysis); err != nil {
		return aiResponse{}, ErrUnavailable
	}
	return analysis, nil
}

func ageAt(now, birthDate time.Time) int {
	age := now.Year() - birthDate.Year()
	if now.Month() < birthDate.Month() || (now.Month() == birthDate.Month() && now.Day() < birthDate.Day()) {
		age--
	}
	return age
}
