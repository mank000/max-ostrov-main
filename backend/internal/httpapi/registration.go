package httpapi

import "strings"

func needsRegistration(path string) bool {
	for _, prefix := range []string{
		"/api/v1/clips",
		"/api/v1/games",
		"/api/v1/avatar-likes",
		"/api/v1/dating",
		"/api/v1/feed",
		"/api/v1/posts",
		"/api/v1/comments",
		"/api/v1/events",
		"/api/v1/groups",
		"/api/v1/store",
		"/api/v1/media/images",
		"/api/v1/media/videos",
		"/api/v1/media/clips",
		"/api/v1/media/comment-images",
		"/api/v1/media/comment-videos",
		"/api/v1/media/event-images",
		"/api/v1/media/attendance-images",
		"/api/v1/support",
	} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	if !strings.HasPrefix(path, "/api/v1/users/") {
		return false
	}
	return path != "/api/v1/users/me" && path != "/api/v1/users/me/presence" &&
		!strings.HasPrefix(path, "/api/v1/users/me/avatar") && path != "/api/v1/users/me/face-verification"
}
