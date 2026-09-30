package httpapi

import (
	"context"
	"errors"
	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/users"
	"net/http"
	"strconv"
	"strings"
)

func handleAvatarLikes(auth *maxauth.Service, service userService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodGet, http.MethodPut, http.MethodDelete) {
			return
		}
		viewer, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/v1/avatar-likes/"), "/")
		if len(parts) != 2 {
			handleNotFound(w, r)
			return
		}
		owner, e1 := strconv.ParseInt(parts[0], 10, 64)
		media, e2 := strconv.ParseInt(parts[1], 10, 64)
		after := int64(0)
		var err error
		if r.URL.Query().Get("after") != "" {
			after, err = strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		}
		if e1 != nil || e2 != nil || err != nil || owner <= 0 || media < 0 || after < 0 {
			writeError(w, 400, "invalid_avatar", "Некорректная фотография")
			return
		}
		repo, ok := service.(interface {
			AvatarLikes(context.Context, int64, int64, int64, int64, *bool) (users.AvatarLikes, error)
		})
		if !ok {
			handleNotFound(w, r)
			return
		}
		var like *bool
		if r.Method != http.MethodGet {
			value := r.Method == http.MethodPut
			like = &value
		}
		result, err := repo.AvatarLikes(r.Context(), viewer, owner, media, after, like)
		if errors.Is(err, users.ErrNotFound) || errors.Is(err, users.ErrInvalidAvatar) {
			writeError(w, 404, "not_found", "Фото недоступно")
			return
		}
		if err != nil {
			writeError(w, 500, "internal_error", "Не удалось загрузить лайки")
			return
		}
		writeJSON(w, 200, result)
	}
}
