package httpapi

import (
	"errors"
	"kutezh/backend/internal/games"
	"kutezh/backend/internal/maxauth"
	"net/http"
)

func handleGames(auth *maxauth.Service, service *games.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		var run games.Run
		var err error
		if r.URL.Path == "/api/v1/games/start" {
			var input struct {
				Kind string `json:"kind"`
				Key  string `json:"request_key"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, 400, "invalid_body", "Некорректный игровой запрос")
				return
			}
			run, err = service.Start(r.Context(), id, input.Kind, input.Key)
		} else {
			var input struct {
				ID     string `json:"id"`
				Step   int    `json:"step"`
				Answer []int  `json:"answer"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, 400, "invalid_body", "Некорректный игровой запрос")
				return
			}
			run, err = service.Answer(r.Context(), id, input.ID, input.Step, input.Answer)
		}
		if err != nil {
			status := 500
			message := "Не удалось сохранить игру. Повторите попытку"
			switch {
			case errors.Is(err, games.ErrInput):
				status = 400
				message = "Некорректный игровой запрос"
			case errors.Is(err, games.ErrMissing):
				status = 404
				message = "Раунд не найден"
			case errors.Is(err, games.ErrEarly):
				status = 409
				message = "Подождите окончания показа задания"
			case errors.Is(err, games.ErrLimit):
				status = 429
				message = "Слишком много новых игр. Попробуйте через минуту"
			}
			writeError(w, status, "game_error", message)
			return
		}
		writeJSON(w, http.StatusOK, run)
	}
}


func handleFlappyGames(auth *maxauth.Service, service *games.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		var run games.FlappyRun
		var err error
		if r.URL.Path == "/api/v1/games/flappy/start" {
			var input struct {
				Key string `json:"request_key"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_body", "Некорректный игровой запрос")
				return
			}
			run, err = service.StartFlappy(r.Context(), id, input.Key)
		} else {
			var input struct {
				ID   string `json:"id"`
				Pipe int    `json:"pipe"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_body", "Некорректный игровой запрос")
				return
			}
			run, err = service.CollectFlappy(r.Context(), id, input.ID, input.Pipe)
		}
		if err != nil {
			status := http.StatusInternalServerError
			message := "Не удалось сохранить игру. Повторите попытку"
			switch {
			case errors.Is(err, games.ErrInput):
				status = http.StatusBadRequest
				message = "Некорректный игровой запрос"
			case errors.Is(err, games.ErrMissing):
				status = http.StatusNotFound
				message = "Раунд не найден"
			case errors.Is(err, games.ErrEarly):
				status = http.StatusConflict
				message = "Эта монета ещё не достигнута"
			case errors.Is(err, games.ErrLimit):
				status = http.StatusTooManyRequests
				message = "Слишком много новых игр. Попробуйте через минуту"
			}
			writeError(w, status, "game_error", message)
			return
		}
		writeJSON(w, http.StatusOK, run)
	}
}
