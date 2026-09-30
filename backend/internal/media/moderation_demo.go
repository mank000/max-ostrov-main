//go:build demo

package media

import "context"

// Только локальное демо: декодирование и лимиты уже проверены в upload.
// Это не проверка содержимого нейросетью; для публичного сервера нужен production.
func (s *Service) moderate(ctx context.Context, userID int64, asset Asset) (Asset, error) {
	approver, ok := s.repository.(interface {
		ApproveModerated(context.Context, int64) error
	})
	if !ok {
		s.discard(userID, asset.ID)
		return Asset{}, ErrAnalysisUnavailable
	}
	if err := approver.ApproveModerated(ctx, asset.ID); err != nil {
		s.discard(userID, asset.ID)
		return Asset{}, err
	}
	return asset, nil
}
