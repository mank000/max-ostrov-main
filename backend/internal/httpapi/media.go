package httpapi

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/media"
)

func handleMediaUpload(authService *maxauth.Service, service mediaService) http.HandlerFunc {
	return handleImageUpload(authService, service, false, false)
}

func handleAvatarUpload(authService *maxauth.Service, service mediaService) http.HandlerFunc {
	return handleImageUpload(authService, service, true, true)
}

func handleProfileImageUpload(authService *maxauth.Service, service mediaService) http.HandlerFunc {
	return handleImageUpload(authService, service, false, true)
}

func handleCommentImageUpload(authService *maxauth.Service, service mediaService) http.HandlerFunc {
	return handleImageUpload(authService, service, false, true)
}

func handleEventImageUpload(authService *maxauth.Service, service mediaService) http.HandlerFunc {
	return handleImageUpload(authService, service, false, true)
}

func handleAttendanceImageUpload(authService *maxauth.Service, service mediaService) http.HandlerFunc {
	return handleImageUpload(authService, service, false, true)
}

func handleCommentVideoUpload(authService *maxauth.Service, service mediaService) http.HandlerFunc {
	return handleVideoUpload(authService, service, true)
}

func handleVideoUpload(authService *maxauth.Service, service mediaService, moderated bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, media.MaxVideoUploadBytes+(1<<20))
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				writeError(w, http.StatusRequestEntityTooLarge, "media_too_large", "Видео не должно превышать 100 МБ")
				return
			}
			writeError(w, http.StatusBadRequest, "invalid_media", "Не удалось прочитать видео")
			return
		}
		if r.MultipartForm == nil {
			writeError(w, http.StatusBadRequest, "invalid_media", "Не удалось прочитать видео")
			return
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()
		files := r.MultipartForm.File["file"]
		transcode := r.URL.Path == "/api/v1/media/clips" && r.FormValue("transcode") == "1"
		if len(files) != 1 || len(r.MultipartForm.File) != 1 || (!transcode && len(r.MultipartForm.Value) != 0) {
			writeError(w, http.StatusBadRequest, "invalid_media", "Загрузите одно видео")
			return
		}
		if files[0].Size > media.MaxVideoUploadBytes {
			writeError(w, http.StatusRequestEntityTooLarge, "media_too_large", "Видео не должно превышать 100 МБ")
			return
		}
		file, err := files[0].Open()
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_media", "Не удалось прочитать видео")
			return
		}
		defer func() { _ = file.Close() }()
		var asset media.Asset
		if r.URL.Path == "/api/v1/media/clips" {
			uploader, ok := service.(interface {
				UploadClip(context.Context, int64, io.Reader) (media.Asset, error)
			})
			if !ok {
				writeError(w, 503, "clips_unavailable", "Загрузка видео временно недоступна")
				return
			}
			if transcode {
				transcoder, ok := service.(interface {
					TranscodeClip(context.Context, int64, io.Reader, media.ClipEdit) (media.Asset, error)
				})
				if !ok {
					writeError(w, 503, "clips_unavailable", "Обработка видео временно недоступна")
					return
				}
				start, startErr := strconv.ParseFloat(r.FormValue("start"), 64)
				end, endErr := strconv.ParseFloat(r.FormValue("end"), 64)
				rotation, rotationErr := strconv.Atoi(r.FormValue("rotation"))
				if startErr != nil || endErr != nil || rotationErr != nil ||
					(r.FormValue("muted") != "0" && r.FormValue("muted") != "1") ||
					(r.FormValue("portrait") != "0" && r.FormValue("portrait") != "1") || len(r.MultipartForm.Value) != 6 {
					writeError(w, 400, "invalid_clip_edit", "Некорректные настройки видео")
					return
				}
				asset, err = transcoder.TranscodeClip(r.Context(), userID, file, media.ClipEdit{
					Start: start, End: end, Rotation: rotation,
					Muted: r.FormValue("muted") == "1", Portrait: r.FormValue("portrait") == "1",
				})
			} else {
				asset, err = uploader.UploadClip(r.Context(), userID, file)
			}
			if errors.Is(err, media.ErrInvalidVideo) || errors.Is(err, media.ErrVideoTooLong) {
				writeError(w, 400, "invalid_clip", "Не удалось обработать видео. Попробуйте другой файл или более короткий фрагмент.")
				return
			}
		} else if moderated {
			asset, err = service.UploadModeratedVideo(r.Context(), userID, file)
		} else {
			asset, err = service.UploadVideo(r.Context(), userID, file)
		}
		switch {
		case errors.Is(err, media.ErrUnsafeMedia):
			writeError(w, http.StatusUnprocessableEntity, "unsafe_media", "Это видео не проходит правила сообщества. Выберите другой файл.")
		case errors.Is(err, media.ErrAnalysisUnavailable):
			writeError(w, http.StatusServiceUnavailable, "media_analysis_unavailable", "Не удалось проверить видео. Повторите попытку позже.")
		case errors.Is(err, media.ErrTooLarge):
			writeError(w, http.StatusRequestEntityTooLarge, "media_too_large", "Видео не должно превышать 100 МБ")
		case errors.Is(err, media.ErrVideoTooLong):
			writeError(w, http.StatusBadRequest, "video_too_long", "Видео должно быть не длиннее 5 минут")
		case errors.Is(err, media.ErrInvalidVideo):
			writeError(w, http.StatusBadRequest, "invalid_media", "Поддерживаются корректные MP4 и MOV до 5 минут")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось загрузить видео")
		default:
			writeJSON(w, http.StatusCreated, asset)
		}
	}
}

func handleImageUpload(authService *maxauth.Service, service mediaService, avatar, moderated bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, authService)
		if !ok {
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+(1<<20))
		if err := r.ParseMultipartForm(media.MaxUploadBytes); err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				writeError(w, http.StatusRequestEntityTooLarge, "media_too_large", "Изображение не должно превышать 10 МБ")
				return
			}
			writeError(w, http.StatusBadRequest, "invalid_media", "Не удалось прочитать изображение")
			return
		}
		if r.MultipartForm == nil {
			writeError(w, http.StatusBadRequest, "invalid_media", "Не удалось прочитать изображение")
			return
		}
		defer func() { _ = r.MultipartForm.RemoveAll() }()
		files := r.MultipartForm.File["file"]
		if len(files) != 1 || len(r.MultipartForm.File) != 1 || len(r.MultipartForm.Value) != 0 {
			writeError(w, http.StatusBadRequest, "invalid_media", "Загрузите одно изображение")
			return
		}
		if files[0].Size > media.MaxUploadBytes {
			writeError(w, http.StatusRequestEntityTooLarge, "media_too_large", "Изображение не должно превышать 10 МБ")
			return
		}
		file, err := files[0].Open()
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_media", "Не удалось прочитать изображение")
			return
		}
		defer func() { _ = file.Close() }()
		var asset media.Asset
		if moderated {
			asset, err = service.UploadModeratedImage(r.Context(), userID, file, avatar)
		} else if avatar {
			asset, err = service.UploadAvatar(r.Context(), userID, file)
		} else {
			asset, err = service.Upload(r.Context(), userID, file)
		}
		switch {
		case errors.Is(err, media.ErrUnsafeMedia):
			writeError(w, http.StatusUnprocessableEntity, "unsafe_media", "Это изображение не проходит правила сообщества. Выберите другое фото.")
		case errors.Is(err, media.ErrAnalysisUnavailable):
			writeError(w, http.StatusServiceUnavailable, "media_analysis_unavailable", "Не удалось проверить изображение. Повторите попытку позже.")
		case errors.Is(err, media.ErrTooLarge):
			writeError(w, http.StatusRequestEntityTooLarge, "media_too_large", "Изображение не должно превышать 10 МБ")
		case errors.Is(err, media.ErrInvalidImage):
			writeError(w, http.StatusBadRequest, "invalid_media", "Поддерживаются корректные JPEG и PNG")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось загрузить изображение")
		default:
			writeJSON(w, http.StatusCreated, asset)
		}
	}
}

func handleMedia(authService *maxauth.Service, service mediaService, xAccel bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/media/"), "/")
		parts := strings.Split(path, "/")
		mediaID, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil || mediaID <= 0 || len(parts) > 2 || (len(parts) == 2 && parts[1] != "content" && parts[1] != "download") {
			handleNotFound(w, r)
			return
		}
		download := len(parts) == 2 && parts[1] == "download"
		var userID int64
		if download && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			values, err := url.ParseQuery(r.URL.RawQuery)
			if err != nil || len(values["token"]) != 1 {
				writeSessionError(w, maxauth.ErrInvalidSession)
				return
			}
			userID, err = authService.DownloadUser(values.Get("token"), mediaID)
			if err != nil {
				writeSessionError(w, err)
				return
			}

		} else if len(parts) == 2 && parts[1] == "content" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			session, err := readResourceSession(r, authService, maxauth.MediaRead)
			if err != nil {
				writeSessionError(w, err)
				return
			}
			userID = session.User.ID
		} else {
			var ok bool
			userID, ok = authenticatedUserID(w, r, authService)
			if !ok {
				return
			}
		}
		if download && !allowMethods(w, r, http.MethodGet, http.MethodHead, http.MethodPost) {
			return
		}
		if download && r.Method == http.MethodPost {
			_, file, err := service.Open(r.Context(), userID, mediaID)
			if errors.Is(err, media.ErrNotFound) {
				writeError(w, http.StatusNotFound, "not_found", "Медиафайл не найден")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось открыть медиафайл")
				return
			}
			_ = file.Close()
			token, expires, err := authService.CreateDownloadToken(requestSessionToken(r), mediaID)
			if err != nil {
				writeSessionError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"url":        "/api/v1/media/" + strconv.FormatInt(mediaID, 10) + "/download?token=" + token,
				"expires_at": expires,
			})
			return
		}
		if len(parts) == 2 {
			if !allowMethods(w, r, http.MethodGet, http.MethodHead) {
				return
			}
			asset, file, err := service.Open(r.Context(), userID, mediaID)
			if errors.Is(err, media.ErrNotFound) {
				writeError(w, http.StatusNotFound, "not_found", "Медиафайл не найден")
				return
			}
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось открыть медиафайл")
				return
			}
			defer func() { _ = file.Close() }()
			w.Header().Set("Content-Type", asset.MIMEType)
			w.Header().Set("Cache-Control", "private, no-cache")
			w.Header().Set("Vary", "Cookie, Authorization")
			w.Header().Set("Referrer-Policy", "no-referrer")
			if download {
				w.Header().Set("Cache-Control", "private, no-store")
				w.Header().Set("Referrer-Policy", "no-referrer")
				w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
					"filename": "kutezh-media-" + strconv.FormatInt(mediaID, 10) + filepath.Ext(asset.StorageKey),
				}))
			}
			if xAccel {
				if !media.ValidStorageKey(asset.StorageKey) {
					writeError(w, http.StatusNotFound, "not_found", "Медиафайл не найден")
					return
				}
				w.Header().Set("X-Accel-Redirect", "/private-media/"+asset.StorageKey)
				return
			}
			controller := http.NewResponseController(w)
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Minute))
			defer func() { _ = controller.SetWriteDeadline(time.Time{}) }()
			http.ServeContent(w, r, "", asset.CreatedAt, file)
			return
		}
		if !allowMethods(w, r, http.MethodDelete) {
			return
		}
		err = service.Delete(r.Context(), userID, mediaID)
		switch {
		case errors.Is(err, media.ErrNotFound):
			writeError(w, http.StatusNotFound, "not_found", "Медиафайл не найден")
		case errors.Is(err, media.ErrInUse):
			writeError(w, http.StatusConflict, "media_in_use", "Медиафайл уже используется")
		case err != nil:
			writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось удалить медиафайл")
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}
