package moderation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"kutezh/backend/internal/media"
)

type EvidenceMedia struct {
	MIMEType string
	Size     int64
	File     *os.File
}

func (s *Service) OpenReportMedia(ctx context.Context, reportID, mediaID int64) (EvidenceMedia, error) {
	if reportID <= 0 || mediaID <= 0 {
		return EvidenceMedia{}, ErrNotFound
	}
	var snapshot []byte
	if err := s.db.QueryRowContext(ctx, `SELECT target_snapshot FROM moderation_reports WHERE id=$1`, reportID).Scan(&snapshot); errors.Is(err, sql.ErrNoRows) {
		return EvidenceMedia{}, ErrNotFound
	} else if err != nil {
		return EvidenceMedia{}, fmt.Errorf("load report evidence: %w", err)
	}
	var data struct {
		MediaIDs []int64 `json:"media_ids"`
	}
	if err := json.Unmarshal(snapshot, &data); err != nil {
		return EvidenceMedia{}, fmt.Errorf("decode report evidence: %w", err)
	}
	allowed := false
	for _, id := range data.MediaIDs {
		if id == mediaID {
			allowed = true
			break
		}
	}
	if !allowed {
		return EvidenceMedia{}, ErrNotFound
	}
	var key, mime string
	var size int64
	if err := s.db.QueryRowContext(ctx, `SELECT storage_key,mime_type,byte_size FROM media_assets WHERE id=$1`, mediaID).Scan(&key, &mime, &size); errors.Is(err, sql.ErrNoRows) {
		return EvidenceMedia{}, ErrNotFound
	} else if err != nil {
		return EvidenceMedia{}, fmt.Errorf("load report media: %w", err)
	}
	if !media.ValidStorageKey(key) {
		return EvidenceMedia{}, ErrNotFound
	}
	file, err := os.Open(filepath.Join(s.mediaDir, key))
	if errors.Is(err, os.ErrNotExist) {
		return EvidenceMedia{}, ErrNotFound
	}
	if err != nil {
		return EvidenceMedia{}, fmt.Errorf("open report media: %w", err)
	}
	return EvidenceMedia{MIMEType: mime, Size: size, File: file}, nil
}

func (s *Service) loadReportMedia(ctx context.Context, reports []Report) error {
	if len(reports) == 0 {
		return nil
	}
	ids := make([]int64, len(reports))
	byID := make(map[int64]*Report, len(reports))
	for i := range reports {
		ids[i] = reports[i].ID
		byID[reports[i].ID] = &reports[i]
	}
	rows, err := s.db.QueryContext(ctx, `
  SELECT evidence.report_id, media.id, media.mime_type
  FROM moderation_evidence_media evidence JOIN media_assets media ON media.id = evidence.media_id
  WHERE evidence.report_id = ANY($1::bigint[]) ORDER BY evidence.report_id, media.id`, ids)
	if err != nil {
		return fmt.Errorf("get report media: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var reportID int64
		var media ReportMedia
		if err := rows.Scan(&reportID, &media.ID, &media.MIMEType); err != nil {
			return fmt.Errorf("read report media: %w", err)
		}
		report := byID[reportID]
		report.Media = append(report.Media, media)
	}
	return rows.Err()
}
