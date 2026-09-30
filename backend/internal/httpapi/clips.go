package httpapi

import (
	"errors"
	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/posts"
	"net/http"
	"strconv"
	"strings"
)

func handleClips(auth *maxauth.Service, service *posts.ClipService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		viewer, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/clips"), "/")
		if path == "inbox" {
			if !allowMethods(w, r, http.MethodGet, http.MethodPut) {
				return
			}
			if r.Method == http.MethodPut {
				if err := service.ReadInbox(r.Context(), viewer); writePostError(w, err) {
					return
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
			messages, err := service.Messages(r.Context(), viewer)
			if err != nil {
				writeError(w, 500, "internal_error", "Не удалось загрузить присланное")
				return
			}
			writeJSON(w, 200, map[string]any{"messages": messages})
			return
		}
		if strings.HasPrefix(path, "inbox/") {
			parts := strings.Split(path, "/")
			if len(parts) < 2 || len(parts) > 3 {
				handleNotFound(w, r)
				return
			}
			id, err := strconv.ParseInt(parts[1], 10, 64)
			if err != nil || id <= 0 {
				handleNotFound(w, r)
				return
			}
			if len(parts) == 2 {
				if !allowMethods(w, r, http.MethodDelete) {
					return
				}
				err = service.DeleteMessage(
					r.Context(),
					viewer,
					id,
					r.URL.Query().Get("for_everyone") == "1",
				)
			} else {
				switch parts[2] {
				case "read":
					if !allowMethods(w, r, http.MethodPut) {
						return
					}
					err = service.ReadMessages(r.Context(), viewer, id)
				case "react":
					if !allowMethods(w, r, http.MethodPut) {
						return
					}
					var body struct {
						Emoji string `json:"emoji"`
					}
					if decodeJSON(w, r, &body) != nil {
						writeError(w, 400, "invalid_reaction", "Выберите реакцию")
						return
					}
					err = service.React(r.Context(), viewer, id, body.Emoji)
				default:
					handleNotFound(w, r)
					return
				}
			}
			if writePostError(w, err) {
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if path == "" {
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			scope := r.URL.Query().Get("scope")
			if scope == "" {
				scope = "for-you"
			}
			var author int64
			if raw := r.URL.Query().Get("author_id"); raw != "" {
				var err error
				author, err = strconv.ParseInt(raw, 10, 64)
				if err != nil || author <= 0 {
					writeError(w, 400, "invalid_author", "Некорректный автор")
					return
				}
			}
			page, err := service.Feed(r.Context(), viewer, scope, r.URL.Query().Get("cursor"), author)
			if errors.Is(err, posts.ErrInvalidRankCursor) {
				writeError(w, 400, "expired_clip_feed", "Лента устарела. Откройте раздел заново.")
				return
			}
			if writePostError(w, err) {
				return
			}
			writeJSON(w, 200, page)
			return
		}
		if !strings.Contains(path, "/") {
			id, err := strconv.ParseInt(path, 10, 64)
			if err != nil || id <= 0 {
				handleNotFound(w, r)
				return
			}
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			clip, err := service.Get(r.Context(), viewer, id)
			if writePostError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, clip)
			return
		}
		parts := strings.Split(path, "/")
		if len(parts) != 2 {
			handleNotFound(w, r)
			return
		}
		id, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || id <= 0 {
			handleNotFound(w, r)
			return
		}
		switch parts[1] {
		case "share":
			if !allowMethods(w, r, http.MethodPost) {
				return
			}
			var body struct {
				Recipient int64 `json:"recipient_id"`
			}
			if decodeJSON(w, r, &body) != nil {
				writeError(w, 400, "invalid_recipient", "Выберите друга")
				return
			}
			err = service.Share(r.Context(), viewer, id, body.Recipient)
		case "feedback":
			if !allowMethods(w, r, http.MethodPut) {
				return
			}
			var body struct {
				Watched int  `json:"watched_ms"`
				Hidden  bool `json:"hidden"`
			}
			if decodeJSON(w, r, &body) != nil {
				writeError(w, 400, "invalid_feedback", "Некорректное действие")
				return
			}
			err = service.Feedback(r.Context(), viewer, id, body.Watched, body.Hidden)
		case "cover":
			if !allowMethods(w, r, http.MethodPut) {
				return
			}
			var body struct {
				Cover int `json:"cover_ms"`
			}
			if decodeJSON(w, r, &body) != nil {
				writeError(w, 400, "invalid_cover", "Выберите обложку")
				return
			}
			err = service.Cover(r.Context(), viewer, id, body.Cover)
		default:
			handleNotFound(w, r)
			return
		}
		if writePostError(w, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
