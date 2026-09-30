//go:build !demo

package httpapi

import (
	"net/http"
	"strings"
)

func moderationHostAllowed(r *http.Request, config HandlerConfig) bool {
	return config.ModerationHost != "" && strings.EqualFold(r.Host, config.ModerationHost)
}
