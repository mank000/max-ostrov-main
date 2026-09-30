package httpapi

import (
	"net/http"
	"net/url"
	"strings"
)

func sameOriginMutation(r *http.Request, secure bool) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return true
	}
	if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
		return false
	}
	origins := r.Header.Values("Origin")
	if len(origins) == 0 {
		return true
	}
	if len(origins) != 1 || origins[0] == "" {
		return false
	}
	origin, err := url.Parse(origins[0])
	if err != nil || origin.User != nil || origin.Host == "" || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		return false
	}
	scheme := "http"
	if secure || r.TLS != nil {
		scheme = "https"
	}
	target, err := url.Parse(scheme + "://" + r.Host)
	if err != nil || origin.Scheme != scheme || !strings.EqualFold(origin.Hostname(), target.Hostname()) {
		return false
	}
	port := func(u *url.URL) string {
		if value := u.Port(); value != "" {
			return value
		}
		if u.Scheme == "https" {
			return "443"
		}
		return "80"
	}
	return port(origin) == port(target)
}
