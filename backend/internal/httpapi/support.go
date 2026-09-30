package httpapi

import (
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/media"
	"kutezh/backend/internal/moderation"
)

func handleSupport(
	authService *maxauth.Service,
	service *moderation.Service,
	mediaService mediaService,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/support"), "/")
		switch path {
		case "":
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			chat, err := service.UserSupportChat(r.Context(), userID)
			if writeSupportError(w, err) {
				return
			}
			writeJSON(w, http.StatusOK, chat)
		case "messages":
			if !allowMethods(w, r, http.MethodPost) {
				return
			}
			body, asset, err := readSupportUpload(w, r, userID, mediaService)
			if writeSupportError(w, err) {
				return
			}
			message, err := service.SubmitSupportApp(
				r.Context(),
				userID,
				body,
				supportAssetIDs(asset),
			)
			if err != nil && asset != nil && mediaService != nil {
				_ = mediaService.Delete(r.Context(), userID, asset.ID)
			}
			if writeSupportError(w, err) {
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"message": message})
		default:
			handleNotFound(w, r)
		}
	}
}

func handleModerationSupport(
	w http.ResponseWriter,
	r *http.Request,
	service *moderation.Service,
	mediaService mediaService,
	principal moderation.Principal,
	path string,
) {
	if path == "support" {
		if !allowMethods(w, r, http.MethodGet) {
			return
		}
		for key, values := range r.URL.Query() {
			if key != "status" || len(values) != 1 {
				writeError(w, http.StatusBadRequest, "invalid_support_filter", "Проверьте фильтр обращений")
				return
			}
		}
		items, err := service.SupportQueue(r.Context(), r.URL.Query().Get("status"))
		if writeSupportError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"threads": items})
		return
	}

	parts := strings.Split(strings.TrimPrefix(path, "support/"), "/")
	if len(parts) == 0 {
		handleNotFound(w, r)
		return
	}
	threadID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || threadID <= 0 {
		handleNotFound(w, r)
		return
	}
	if len(parts) == 1 {
		if !allowMethods(w, r, http.MethodGet) {
			return
		}
		chat, err := service.SupportChatForStaff(r.Context(), threadID)
		if writeSupportError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, chat)
		return
	}
	if len(parts) == 2 && parts[1] == "messages" {
		if !allowMethods(w, r, http.MethodPost) {
			return
		}
		body, asset, err := readSupportUpload(w, r, principal.UserID, mediaService)
		if writeSupportError(w, err) {
			return
		}
		message, err := service.ReplySupportApp(
			r.Context(),
			threadID,
			principal.UserID,
			body,
			supportAssetIDs(asset),
		)
		if err != nil && asset != nil && mediaService != nil {
			_ = mediaService.Delete(r.Context(), principal.UserID, asset.ID)
		}
		if writeSupportError(w, err) {
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"message": message})
		return
	}
	if len(parts) == 2 && parts[1] == "close" {
		if !allowMethods(w, r, http.MethodPost) {
			return
		}
		if writeSupportError(w, service.CloseSupport(r.Context(), threadID)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(parts) == 2 && parts[1] == "reopen" {
		if !allowMethods(w, r, http.MethodPost) {
			return
		}
		if writeSupportError(w, service.ReopenSupport(r.Context(), threadID)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(parts) == 3 && parts[1] == "media" {
		if !allowMethods(w, r, http.MethodGet, http.MethodHead) {
			return
		}
		mediaID, err := strconv.ParseInt(parts[2], 10, 64)
		if err != nil || mediaID <= 0 {
			handleNotFound(w, r)
			return
		}
		item, err := service.OpenSupportMedia(r.Context(), threadID, mediaID)
		if writeSupportError(w, err) {
			return
		}
		defer func() { _ = item.File.Close() }()
		w.Header().Set("Content-Type", item.MIMEType)
		w.Header().Set("Content-Disposition", "inline")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, "support-attachment", time.Time{}, item.File)
		return
	}
	handleNotFound(w, r)
}

func readSupportUpload(
	w http.ResponseWriter,
	r *http.Request,
	ownerID int64,
	service mediaService,
) (string, *media.Asset, error) {
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxVideoUploadBytes+(2<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return "", nil, media.ErrTooLarge
		}
		return "", nil, moderation.ErrInvalid
	}
	if r.MultipartForm == nil {
		return "", nil, moderation.ErrInvalid
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	for key := range r.MultipartForm.Value {
		if key != "body" {
			return "", nil, moderation.ErrInvalid
		}
	}
	for key := range r.MultipartForm.File {
		if key != "file" {
			return "", nil, moderation.ErrInvalid
		}
	}
	body := strings.TrimSpace(r.FormValue("body"))
	files := r.MultipartForm.File["file"]
	if len(files) > 1 {
		return "", nil, moderation.ErrInvalid
	}
	if len(files) == 0 {
		return body, nil, nil
	}
	if service == nil {
		return "", nil, moderation.ErrUnavailable
	}

	fileHeader := files[0]
	file, err := fileHeader.Open()
	if err != nil {
		return "", nil, moderation.ErrInvalid
	}
	defer file.Close()
	contentType := strings.ToLower(strings.TrimSpace(fileHeader.Header.Get("Content-Type")))
	extension := strings.ToLower(filepath.Ext(fileHeader.Filename))
	var asset media.Asset
	switch {
	case strings.HasPrefix(contentType, "image/") ||
		extension == ".jpg" || extension == ".jpeg" || extension == ".png":
		asset, err = service.Upload(r.Context(), ownerID, file)
	case strings.HasPrefix(contentType, "video/") ||
		extension == ".mp4" || extension == ".mov":
		asset, err = service.UploadVideo(r.Context(), ownerID, file)
	default:
		return "", nil, moderation.ErrInvalid
	}
	if err != nil {
		return "", nil, err
	}
	return body, &asset, nil
}

func supportAssetIDs(asset *media.Asset) []int64 {
	if asset == nil {
		return nil
	}
	return []int64{asset.ID}
}

func writeSupportError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, moderation.ErrSupportLimit):
		writeError(w, http.StatusTooManyRequests, "support_rate_limited", "Слишком много сообщений. Попробуйте через минуту")
	case errors.Is(err, moderation.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_support_message", "Напишите сообщение или прикрепите фото/видео")
	case errors.Is(err, moderation.ErrNotFound):
		writeError(w, http.StatusNotFound, "support_not_found", "Обращение не найдено")
	case errors.Is(err, moderation.ErrConflict):
		writeError(w, http.StatusConflict, "support_closed", "Обращение закрыто. Откройте его снова")
	case errors.Is(err, moderation.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "support_unavailable", "Поддержка временно недоступна")
	case errors.Is(err, media.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "media_too_large", "Фото — до 10 МБ, видео — до 100 МБ")
	case errors.Is(err, media.ErrVideoTooLong):
		writeError(w, http.StatusBadRequest, "video_too_long", "Видео должно быть не длиннее 5 минут")
	case errors.Is(err, media.ErrInvalidImage), errors.Is(err, media.ErrInvalidVideo):
		writeError(w, http.StatusBadRequest, "invalid_support_media", "Поддерживаются JPEG/PNG и MP4/MOV")
	default:
		writeError(w, http.StatusInternalServerError, "support_error", "Не удалось выполнить действие в поддержке")
	}
	return true
}
