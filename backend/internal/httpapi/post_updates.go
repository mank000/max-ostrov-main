package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"kutezh/backend/internal/maxauth"
)

func parseUpdateIDs(r *http.Request) ([]int64, bool) {
	values := r.URL.Query()
	if len(values) != 1 || len(values["ids"]) != 1 {
		return nil, false
	}
	parts := strings.Split(values.Get("ids"), ",")
	if len(parts) == 0 || len(parts) > 50 {
		return nil, false
	}
	ids := make([]int64, 0, len(parts))
	seen := make(map[int64]bool, len(parts))
	for _, part := range parts {
		id, err := strconv.ParseInt(part, 10, 64)
		if err != nil || id <= 0 || seen[id] {
			return nil, false
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids, true
}

func handlePostUpdates(auth *maxauth.Service, service postService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		ids, ok := parseUpdateIDs(r)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_post_ids", "Некорректный список публикаций")
			return
		}
		items, err := service.ListByIDs(r.Context(), userID, ids)
		if writePostError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, postsResponse{Posts: items})
	}
}
