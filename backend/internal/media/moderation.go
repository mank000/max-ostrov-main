//go:build !demo

package media

import "context"

func (s *Service) moderate(ctx context.Context, userID int64, asset Asset) (Asset, error) {
	if s.analyzer == nil {
		s.discard(userID, asset.ID)
		return Asset{}, ErrAnalysisUnavailable
	}
	labels, err := s.analyzer.HardMediaLabels(ctx, asset.StorageKey, asset.MIMEType, asset.DurationMS)
	if err != nil {
		s.discard(userID, asset.ID)
		return Asset{}, ErrAnalysisUnavailable
	}
	if len(labels) != 0 {
		s.discard(userID, asset.ID)
		return Asset{}, ErrUnsafeMedia
	}
	approver, ok := s.repository.(interface {
		ApproveModerated(context.Context, int64) error
	})
	if !ok || approver.ApproveModerated(ctx, asset.ID) != nil {
		s.discard(userID, asset.ID)
		return Asset{}, ErrAnalysisUnavailable
	}
	return asset, nil
}
