package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/posts"
)

type postsResponse struct {
	Posts          []posts.Post `json:"posts"`
	NextCursor     *int64       `json:"next_cursor,omitempty"`
	NextRankCursor *string      `json:"next_rank_cursor,omitempty"`
}

type commentsResponse struct {
	Comments       []posts.Comment `json:"comments"`
	NextCursor     *int64          `json:"next_cursor,omitempty"`
	NextRankCursor *string         `json:"next_rank_cursor,omitempty"`
}

type likesResponse struct {
	Users []posts.User `json:"users"`
}

type taggedPostService interface {
	ListTagged(context.Context, int64, int64, int64) ([]posts.Post, error)
}

func handleEventPosts(w http.ResponseWriter, r *http.Request, authService *maxauth.Service, service postService, eventID int64) {
	if !allowMethods(w, r, http.MethodGet, http.MethodPost) {
		return
	}
	userID, ok := authenticatedUserID(w, r, authService)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		beforeID, ok := parseCursor(r)
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор ленты")
			return
		}
		items, err := service.ListEvent(r.Context(), userID, eventID, beforeID)
		writePostsResult(w, items, err)
		return
	}
	idempotencyKey, ok := requireIdempotencyKey(w, r)
	if !ok {
		return
	}
	var input posts.CreateInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_post", "Добавьте текст или изображение")
		return
	}
	post, err := service.CreateForEvent(r.Context(), userID, eventID, idempotencyKey, input)
	if writePostError(w, err) {
		return
	}
	writeJSON(w, http.StatusCreated, post)
}

func handleCreatePost(authService *maxauth.Service, service postService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		idempotencyKey, ok := requireIdempotencyKey(w, r)
		if !ok {
			return
		}
		var input posts.CreateInput
		if err := decodeJSON(w, r, &input); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_post", "Добавьте текст или изображение")
			return
		}
		post, err := service.Create(r.Context(), userID, idempotencyKey, input)
		if writePostError(w, err) {
			return
		}
		writeJSON(w, http.StatusCreated, post)
	}
}

func handleMyPosts(authService *maxauth.Service, service postService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		beforeID, ok := parseCursor(r, "view")
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор публикаций")
			return
		}
		values := r.URL.Query()
		view := values.Get("view")
		if len(values["view"]) > 1 || (view != "" && view != "tagged") {
			writeError(w, http.StatusBadRequest, "invalid_post_view", "Выберите раздел публикаций")
			return
		}
		if view == "tagged" {
			tagged, supported := service.(taggedPostService)
			if !supported {
				writeError(w, http.StatusInternalServerError, "internal_error", "Отметки временно недоступны")
				return
			}
			items, err := tagged.ListTagged(r.Context(), userID, userID, beforeID)
			writePostsResult(w, items, err)
			return
		}
		items, err := service.ListAuthor(r.Context(), userID, beforeID)
		writePostsResult(w, items, err)
	}
}

func handleFeed(authService *maxauth.Service, service postService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		values := r.URL.Query()
		if len(values["scope"]) > 1 || len(values["city"]) > 1 || len(values["rank_cursor"]) > 1 {
			writeError(w, http.StatusBadRequest, "invalid_feed_scope", "Выберите ленту")
			return
		}
		scope := posts.FeedScope(values.Get("scope"))
		if scope == "" {
			scope = posts.FeedScopeCity
		}
		if !scope.Valid() {
			writeError(w, http.StatusBadRequest, "invalid_feed_scope", "Выберите ленту")
			return
		}
		if scope == posts.FeedScopeAll && !values.Has("before_id") {
			for key := range values {
				if key != "scope" && key != "rank_cursor" {
					writeError(w, http.StatusBadRequest, "invalid_rank_cursor", "Некорректный курсор ленты")
					return
				}
			}
			rankCursor := values.Get("rank_cursor")
			if values.Has("rank_cursor") && rankCursor == "" {
				writeError(w, http.StatusBadRequest, "invalid_rank_cursor", "Некорректный курсор ленты")
				return
			}
			items, next, err := service.RankedFeed(r.Context(), userID, rankCursor)
			switch {
			case errors.Is(err, posts.ErrInvalidRankCursor):
				writeError(w, http.StatusBadRequest, "invalid_rank_cursor", "Лента обновилась. Загрузите её заново")
			case err != nil:
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось загрузить ленту")
			default:
				writeJSON(w, http.StatusOK, postsResponse{Posts: items, NextRankCursor: next})
			}
			return
		}
		beforeID, ok := parseCursor(r, "scope", "city")
		if !ok {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор ленты")
			return
		}
		city := strings.TrimSpace(values.Get("city"))
		if scope == posts.FeedScopeCity && city == "" {
			writeError(w, http.StatusBadRequest, "city_required", "Выберите город ленты")
			return
		}
		items, err := service.FeedScoped(r.Context(), userID, beforeID, scope, city)
		writePostsResult(w, items, err)
	}
}

func handlePost(authService *maxauth.Service, service postService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/posts/"), "/")
		parts := strings.Split(path, "/")
		postID, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || postID <= 0 || len(parts) > 2 {
			handleNotFound(w, r)
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		if len(parts) == 1 {
			if !allowMethods(w, r, http.MethodGet, http.MethodDelete, http.MethodPatch) {
				return
			}
			if r.Method == http.MethodGet {
				post, err := service.Get(r.Context(), userID, postID)
				if writePostError(w, err) {
					return
				}
				writeJSON(w, http.StatusOK, post)
				return
			}
			if r.Method == http.MethodPatch {
				updater, ok := service.(interface {
					Update(context.Context, int64, int64, posts.UpdateInput) (posts.Post, error)
				})
				if !ok {
					writeError(w, http.StatusInternalServerError, "internal_error", "Редактирование публикации недоступно")
					return
				}
				var input posts.UpdateInput
				if err := decodeJSON(w, r, &input); err != nil {
					writeError(w, http.StatusBadRequest, "invalid_post", "Проверьте текст и изображение публикации")
					return
				}
				post, err := updater.Update(r.Context(), userID, postID, input)
				if writePostError(w, err) {
					return
				}
				writeJSON(w, http.StatusOK, post)
				return
			}
			if writePostError(w, service.Delete(r.Context(), userID, postID)) {
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		switch parts[1] {
		case "feed-feedback":
			if !allowMethods(w, r, http.MethodPut) {
				return
			}
			if writePostError(w, service.HideFromFeed(r.Context(), userID, postID)) {
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case "like":
			if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
				return
			}
			if writePostError(w, service.SetLike(r.Context(), userID, postID, r.Method == http.MethodPut)) {
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case "likes":
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			items, err := service.ListLikes(r.Context(), userID, postID)
			if writePostError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, likesResponse{Users: items})
		case "comments":
			if !allowMethods(w, r, http.MethodGet, http.MethodPost) {
				return
			}
			if r.Method == http.MethodGet {
				values := r.URL.Query()
				if values.Has("ids") {
					ids, ok := parseUpdateIDs(r)
					if !ok {
						writeError(w, http.StatusBadRequest, "invalid_comment_ids", "Некорректный список комментариев")
						return
					}
					items, err := service.CommentsByIDs(r.Context(), userID, postID, ids)
					if writePostError(w, err) {
						return
					}
					writeJSON(w, http.StatusOK, commentsResponse{Comments: items})
					return
				}
				if !values.Has("before_id") {
					if len(values["rank_cursor"]) > 1 {
						writeError(w, http.StatusBadRequest, "invalid_rank_cursor", "Некорректный курсор комментариев")
						return
					}
					for key := range values {
						if key != "rank_cursor" {
							writeError(w, http.StatusBadRequest, "invalid_rank_cursor", "Некорректный курсор комментариев")
							return
						}
					}
					rankCursor := values.Get("rank_cursor")
					if values.Has("rank_cursor") && rankCursor == "" {
						writeError(w, http.StatusBadRequest, "invalid_rank_cursor", "Некорректный курсор комментариев")
						return
					}
					items, next, err := service.RankedComments(r.Context(), userID, postID, rankCursor)
					if errors.Is(err, posts.ErrInvalidRankCursor) {
						writeError(w, http.StatusBadRequest, "invalid_rank_cursor", "Комментарии обновились. Загрузите их заново")
						return
					}
					if writePostError(w, err) {
						return
					}
					writeJSON(w, http.StatusOK, commentsResponse{Comments: items, NextRankCursor: next})
					return
				}
				beforeID, ok := parseCursor(r)
				if !ok {
					writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор комментариев")
					return
				}
				items, err := service.ListComments(r.Context(), userID, postID, beforeID)
				if writePostError(w, err) {
					return
				}
				response := commentsResponse{Comments: items}
				if len(items) == 50 {
					next := items[len(items)-1].ID
					response.NextCursor = &next
				}
				writeJSON(w, http.StatusOK, response)
				return
			}
			var input struct {
				Body            string  `json:"body"`
				MediaIDs        []int64 `json:"media_ids"`
				ParentCommentID *int64  `json:"parent_comment_id"`
			}
			if err := decodeJSON(w, r, &input); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_comment", "Добавьте текст, фото или видео")
				return
			}
			comment, err := service.CreateComment(r.Context(), userID, postID, input.Body, input.MediaIDs, input.ParentCommentID)
			if writePostError(w, err) {
				return
			}
			writeJSON(w, http.StatusCreated, comment)
		default:
			handleNotFound(w, r)
		}
	}
}

func handleComment(authService *maxauth.Service, service postService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/comments/"), "/")
		parts := strings.Split(path, "/")
		commentID, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || commentID <= 0 || len(parts) > 2 {
			handleNotFound(w, r)
			return
		}
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		if len(parts) == 2 {
			if parts[1] != "like" {
				handleNotFound(w, r)
				return
			}
			if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
				return
			}
			if writePostError(w, service.SetCommentLike(r.Context(), userID, commentID, r.Method == http.MethodPut)) {
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !allowMethods(w, r, http.MethodPatch, http.MethodDelete) {
			return
		}
		if r.Method == http.MethodPatch {
			var input struct {
				Body     string  `json:"body"`
				MediaIDs []int64 `json:"media_ids"`
			}
			if err := decodeJSON(w, r, &input); err != nil {
				writeError(w, http.StatusBadRequest, "invalid_comment", "Добавьте текст, фото или видео")
				return
			}
			if writePostError(w, service.UpdateComment(r.Context(), userID, commentID, input.Body, input.MediaIDs)) {
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if writePostError(w, service.DeleteComment(r.Context(), userID, commentID)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func parseCursor(r *http.Request, allowedKeys ...string) (int64, bool) {
	values := r.URL.Query()
	allowed := map[string]struct{}{"before_id": {}}
	for _, key := range allowedKeys {
		allowed[key] = struct{}{}
	}
	for key := range values {
		if _, ok := allowed[key]; !ok {
			return 0, false
		}
	}
	if len(values["before_id"]) > 1 {
		return 0, false
	}
	if values.Get("before_id") == "" {
		return 0, true
	}
	value, err := strconv.ParseInt(values.Get("before_id"), 10, 64)
	return value, err == nil && value > 0
}

func writePostsResult(w http.ResponseWriter, items []posts.Post, err error) {
	if writePostError(w, err) {
		return
	}
	response := postsResponse{Posts: items}
	if len(items) == 50 {
		next := items[len(items)-1].ID
		response.NextCursor = &next
	}
	writeJSON(w, http.StatusOK, response)
}

func writePostError(w http.ResponseWriter, err error) bool {
	if writeContentPolicyError(w, err) {
		return true
	}
	switch {
	case err == nil:
		return false
	case errors.Is(err, posts.ErrCityRequired):
		writeError(w, http.StatusBadRequest, "city_required", "Выберите город публикации")
	case errors.Is(err, posts.ErrInvalidPost):
		writeError(w, http.StatusBadRequest, "invalid_post", "Проверьте текст, изображения и отметки")
	case errors.Is(err, posts.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Публикация или мероприятие не найдены")
	case errors.Is(err, posts.ErrParticipationRequired):
		writeError(w, http.StatusForbidden, "event_participation_required", "Сначала отметьте «Хочу пойти»")
	case errors.Is(err, posts.ErrInvalidMedia):
		writeError(w, http.StatusBadRequest, "invalid_media", "Медиафайл недоступен или уже используется")
	case errors.Is(err, posts.ErrInvalidTag):
		writeError(w, http.StatusBadRequest, "invalid_participant_tag", "Отметить можно только доступного участника мероприятия")
	case errors.Is(err, posts.ErrEditWindowClosed):
		writeError(w, http.StatusConflict, "post_edit_window_closed", "Редактировать публикацию можно только в течение 24 часов после публикации")
	case errors.Is(err, posts.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "idempotency_key_reused", "Этот Idempotency-Key уже использован для другой публикации")
	case errors.Is(err, posts.ErrInvalidComment):
		writeError(w, http.StatusBadRequest, "invalid_comment", "Комментарий должен содержать текст до 1000 символов или до 4 фото/видео")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось обработать публикацию")
	}
	return true
}
