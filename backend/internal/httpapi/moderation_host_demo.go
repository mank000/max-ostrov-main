//go:build demo

package httpapi

import (
	"net"
	"net/http"
	"strings"
)

func moderationHostAllowed(r *http.Request, _ HandlerConfig) bool {
	host := r.Host
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	return strings.EqualFold(host, "localhost") || host == "127.0.0.1" || host == "::1"
}
