package dating

import (
	"context"
	"kutezh/backend/internal/moderation"
	"kutezh/backend/internal/realtime"
	"kutezh/backend/internal/social"
)

type SharedPlatform struct {
	Realtime   *realtime.Broker
	Social     *social.Service
	Moderation *moderation.Service
}

func (p SharedPlatform) Block(ctx context.Context, a, b int64) error {
	return p.Social.Block(ctx, a, b)
}
func (p SharedPlatform) Report(ctx context.Context, a, b int64, reason string) error {
	_, err := p.Moderation.CreateReport(ctx, a, moderation.ReportInput{TargetType: moderation.TargetUser, TargetID: b, Reason: "Знакомства: " + reason})
	return err
}

func (p SharedPlatform) Changed(ids ...int64) {
	if p.Realtime != nil {
		p.Realtime.PublishMany(ids, "dating.updated", struct{}{})
	}
}

func (p SharedPlatform) Notified(ids ...int64) {
	if p.Realtime != nil {
		p.Realtime.PublishMany(ids, "notification.created", struct{}{})
	}
}
