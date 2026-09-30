package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	requestIDHeader           = "X-Request-ID"
	defaultAPIRequestTimeout  = 12 * time.Second
	mediaUploadRequestTimeout = 65 * time.Second
	videoUploadRequestTimeout = 5 * time.Minute
	rateLimitCleanupThreshold = 4096
	rateLimitEntryLimit       = 8192
)

type rateLimitEntry struct {
	count   int
	resetAt time.Time
}

type rateLimiter struct {
	mu          sync.Mutex
	entries     map[string]rateLimitEntry
	now         func() time.Time
	nextCleanup time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{entries: make(map[string]rateLimitEntry), now: time.Now}
}

func (l *rateLimiter) allow(key string, limit int, window time.Duration) (bool, time.Duration) {
	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()

	if len(l.entries) >= rateLimitCleanupThreshold && !now.Before(l.nextCleanup) {
		l.nextCleanup = now.Add(10 * time.Second)
		for candidate, entry := range l.entries {
			if !now.Before(entry.resetAt) {
				delete(l.entries, candidate)
			}
		}
	}

	entry, ok := l.entries[key]
	if !ok || !now.Before(entry.resetAt) {
		if !ok && len(l.entries) >= rateLimitEntryLimit {
			return false, min(window, 10*time.Second)
		}
		l.entries[key] = rateLimitEntry{count: 1, resetAt: now.Add(window)}
		return true, 0
	}
	if entry.count >= limit {
		return false, entry.resetAt.Sub(now)
	}
	entry.count++
	l.entries[key] = entry
	return true, 0
}

func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := newRequestID()
		w.Header().Set(requestIDHeader, requestID)
		ctx := context.WithValue(r.Context(), requestIDContextKey{}, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

type requestIDContextKey struct{}

func requestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestIDContextKey{}).(string)
	return value
}

func newRequestID() string {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err == nil {
		return hex.EncodeToString(value)
	}
	return "fallback-" + strconv.FormatInt(time.Now().UnixNano(), 36)
}

func withRequestDeadline(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		timeout, limited := requestDeadline(r)
		if !limited {
			next.ServeHTTP(w, r)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		controller := http.NewResponseController(w)
		deadline := time.Now().Add(timeout)
		_ = controller.SetReadDeadline(deadline)
		_ = controller.SetWriteDeadline(deadline)
		defer func() { _ = controller.SetReadDeadline(time.Time{}) }()
		defer func() { _ = controller.SetWriteDeadline(time.Time{}) }()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func requestDeadline(r *http.Request) (time.Duration, bool) {
	if r.Method == http.MethodGet && (r.URL.Path == "/api/v1/cities" || r.URL.Path == "/api/v1/places/search" || r.URL.Path == "/api/v1/locations/reverse") {
		return 45 * time.Second, true
	}
	if r.URL.Path == "/api/v1/realtime" {
		return 0, false
	}
	if (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(r.URL.Path, "/api/v1/media/") && (strings.HasSuffix(r.URL.Path, "/content") || strings.HasSuffix(r.URL.Path, "/download")) {
		return 0, false
	}
	if (r.Method == http.MethodGet || r.Method == http.MethodHead) &&
		(strings.HasPrefix(r.URL.Path, "/api/v1/moderation/support/") ||
			strings.HasPrefix(r.URL.Path, "/api/v1/admin/support/")) &&
		strings.Contains(r.URL.Path, "/media/") {
		return 0, false
	}
	if isSupportMessageUpload(r) {
		return videoUploadRequestTimeout, true
	}
	if r.Method == http.MethodPost && (r.URL.Path == "/api/v1/media/images" || r.URL.Path == "/api/v1/media/avatars" || r.URL.Path == "/api/v1/media/profile-images" || r.URL.Path == "/api/v1/media/comment-images" || r.URL.Path == "/api/v1/media/event-images" || r.URL.Path == "/api/v1/media/attendance-images") {
		return mediaUploadRequestTimeout, true
	}
	if r.Method == http.MethodPost && r.URL.Path == "/api/v1/users/me/face-verification" {
		return 30 * time.Second, true
	}
	if r.Method == http.MethodPost && (r.URL.Path == "/api/v1/media/videos" || r.URL.Path == "/api/v1/media/clips" || r.URL.Path == "/api/v1/media/comment-videos") {
		return videoUploadRequestTimeout, true
	}
	return defaultAPIRequestTimeout, true
}

func withRateLimit(limiter *rateLimiter, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		policy, limit, window, limited := requestRateLimitPolicy(r)
		if !limited {
			next.ServeHTTP(w, r)
			return
		}
		key := policy + ":" + requestRateLimitKey(r, policy)
		allowed, retryAfter := limiter.allow("network:"+policy+":"+requestClientKey(r), max(limit*8, 120), window)
		if allowed {
			allowed, retryAfter = limiter.allow(key, limit, window)
		}
		if allowed {
			next.ServeHTTP(w, r)
			return
		}
		seconds := int((retryAfter + time.Second - 1) / time.Second)
		if seconds < 1 {
			seconds = 1
		}
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Слишком много запросов. Повторите попытку чуть позже.")
	})
}

func requestRateLimitPolicy(r *http.Request) (string, int, time.Duration, bool) {
	if isSupportMessageUpload(r) {
		return "upload", 30, time.Minute, true
	}
	if strings.HasPrefix(r.URL.Path, "/api/v1/dating/") {
		return "dating", 90, time.Minute, true
	}
	switch r.URL.Path {
	case "/api/v1/cities", "/api/v1/places/search", "/api/v1/locations/reverse":
		return "geocoding", 60, time.Minute, true
	case "/api/v1/feed", "/api/v1/events/recommendations":
		return "discovery", 90, time.Minute, true
	case "/api/v1/events/viewport", "/api/v1/events/nearby":
		return "map-query", 120, time.Minute, true
	case "/api/v1/realtime":
		return "realtime-connect", 30, time.Minute, true
	case "/api/v1/health":
		return "health", 60, time.Minute, true
	case "/api/v1/moderation/auth/challenge", "/api/v1/moderation/auth/verify":
		return "moderation-auth", 10, time.Minute, true
	case "/api/v1/media/images", "/api/v1/media/avatars", "/api/v1/media/profile-images", "/api/v1/media/comment-images", "/api/v1/media/event-images", "/api/v1/media/attendance-images", "/api/v1/media/videos", "/api/v1/media/clips", "/api/v1/media/comment-videos":
		if r.Method == http.MethodPost {
			return "upload", 30, time.Minute, true
		}
	case "/api/v1/auth/max":
		return "auth", 30, time.Minute, true
	case "/api/v1/users/search":
		return "user-search", 120, time.Minute, true
	case "/api/v1/users/me/suggestions":
		return "user-suggestions", 60, time.Minute, true
	case "/api/v1/users/me/face-verification":
		return "face-verification", 10, time.Hour, true
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		if strings.HasPrefix(r.URL.Path, "/api/v1/") && !(strings.HasPrefix(r.URL.Path, "/api/v1/media/") && strings.HasSuffix(r.URL.Path, "/content")) {
			return "read", 300, time.Minute, true
		}
		return "", 0, 0, false
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return "mutation", 240, time.Minute, true
	default:
		return "", 0, 0, false
	}
}

func requestRateLimitKey(r *http.Request, policy string) string {
	if policy == "realtime-connect" {
		if token := r.URL.Query().Get("resource_token"); len(token) == 99 {
			hash := sha256.Sum256([]byte(token))
			return "resource:" + hex.EncodeToString(hash[:12])
		}
	}
	if policy != "auth" && policy != "moderation-auth" && policy != "geocoding" && policy != "health" {
		if token := requestSessionToken(r); token != "" {
			hash := sha256.Sum256([]byte(token))
			return "session:" + hex.EncodeToString(hash[:12])
		}
	}
	return "ip:" + requestClientKey(r)
}

func requestClientKey(r *http.Request) string {
	host := r.RemoteAddr
	if parsedHost, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = parsedHost
	}
	remoteIP := net.ParseIP(strings.Trim(host, "[]"))
	if remoteIP != nil && remoteIP.IsLoopback() {
		if forwarded := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); forwarded != nil {
			return clientNetwork(forwarded)
		}
	}
	if remoteIP != nil {
		return clientNetwork(remoteIP)
	}
	return "unknown"
}

func clientNetwork(ip net.IP) string {
	if ip.To4() != nil || ip.IsLoopback() {
		return ip.String()
	}
	return ip.Mask(net.CIDRMask(64, 128)).String()
}

func isSupportMessageUpload(r *http.Request) bool {
	if r.Method != http.MethodPost {
		return false
	}
	if r.URL.Path == "/api/v1/support/messages" {
		return true
	}
	return (strings.HasPrefix(r.URL.Path, "/api/v1/moderation/support/") ||
		strings.HasPrefix(r.URL.Path, "/api/v1/admin/support/")) &&
		strings.HasSuffix(r.URL.Path, "/messages")
}

func withUploadLimit(next http.Handler) http.Handler {
	slots := make(chan struct{}, 4)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upload := r.Method == http.MethodPost && (r.URL.Path == "/api/v1/media/images" || r.URL.Path == "/api/v1/media/avatars" || r.URL.Path == "/api/v1/media/profile-images" || r.URL.Path == "/api/v1/media/comment-images" || r.URL.Path == "/api/v1/media/event-images" || r.URL.Path == "/api/v1/media/attendance-images" || r.URL.Path == "/api/v1/media/videos" || r.URL.Path == "/api/v1/media/clips" || r.URL.Path == "/api/v1/media/comment-videos" || r.URL.Path == "/api/v1/users/me/face-verification" || isSupportMessageUpload(r))
		if upload {
			select {
			case slots <- struct{}{}:
				defer func() { <-slots }()
			default:
				w.Header().Set("Retry-After", "3")
				writeError(w, http.StatusServiceUnavailable, "upload_busy", "Сейчас загружается много файлов. Повторите через несколько секунд.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
