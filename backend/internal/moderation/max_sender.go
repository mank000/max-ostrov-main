package moderation

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	maxbot "github.com/max-messenger/max-bot-api-client-go/v2"
	"github.com/max-messenger/max-bot-api-client-go/v2/model"
)

type MAXSender struct {
	api *maxbot.Api
}

func NewMAXSender(token string) *MAXSender {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	api, err := maxbot.NewApi(strings.TrimSpace(token),
		maxbot.WithHTTPClient(&http.Client{Timeout: 45 * time.Second}),
		maxbot.WithPollingTimeout(25*time.Second),
	)
	if err != nil {
		return nil
	}
	return &MAXSender{api: api}
}

func (s *MAXSender) SendCode(ctx context.Context, userID int64, code string) error {
	if s == nil || s.api == nil || userID <= 0 {
		return ErrUnavailable
	}
	_, err := s.api.Messages.Send(ctx, maxbot.NewMessage().SetUser(userID).
		SetText("Код входа в кабинет модерации Кутёж: "+code+"\nКод действует 5 минут. Никому его не сообщайте."))
	if err != nil {
		return fmt.Errorf("send MAX moderation code: %w", err)
	}
	return nil
}

func (s *MAXSender) SendSupportMessage(ctx context.Context, userID int64, body, photoToken string) error {
	if s == nil || s.api == nil || userID <= 0 {
		return ErrUnavailable
	}
	message := maxbot.NewMessage().SetUser(userID).SetText(body)
	if photoToken != "" {
		message.AddAttachByToken(photoToken, model.AttachImage)
	}
	_, err := s.api.Messages.Send(ctx, message)
	if err != nil {
		return fmt.Errorf("send MAX support message: %w", err)
	}
	return nil
}
