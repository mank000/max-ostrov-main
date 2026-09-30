package maxauth

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	maxbot "github.com/max-messenger/max-bot-api-client-go/v2"
)

func (s *Service) BotUsername(ctx context.Context) (string, error) {
	if s.botToken == "" {
		return "", ErrUnavailable
	}
	s.botInfoMu.Lock()
	defer s.botInfoMu.Unlock()
	if s.botUsername != "" {
		return s.botUsername, nil
	}

	api, err := maxbot.NewApi(s.botToken, maxbot.WithHTTPClient(&http.Client{Timeout: 4 * time.Second}))
	if err != nil {
		return "", fmt.Errorf("create MAX API client: %w", err)
	}
	info, err := api.Bots.GetMyInfo(ctx)
	if err != nil {
		return "", fmt.Errorf("get MAX bot info: %w", err)
	}
	username := strings.TrimPrefix(strings.TrimSpace(info.Username), "@")
	if !validPublicBotUsername(username, 1) {
		return "", ErrUnavailable
	}
	s.botUsername = username
	return username, nil
}

func validPublicBotUsername(value string, minLength int) bool {
	if len(value) < minLength || len(value) > 64 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' {
			continue
		}
		return false
	}
	return true
}
