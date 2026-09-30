package httpapi

import (
	"errors"
	"net/http"

	"kutezh/backend/internal/games"
	"kutezh/backend/internal/maxauth"
)

func handleDinoGames(auth *maxauth.Service, service *games.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		var run games.DinoRun
		var err error
		switch r.URL.Path {
		case "/api/v1/games/dino/start":
			var input struct {
				Key string `json:"request_key"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_body", "Некорректный игровой запрос")
				return
			}
			run, err = service.StartDino(r.Context(), id, input.Key)
		case "/api/v1/games/dino/coin":
			var input struct {
				ID   string `json:"id"`
				Coin int    `json:"coin"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_body", "Некорректный игровой запрос")
				return
			}
			run, err = service.ClaimDinoCoin(r.Context(), id, input.ID, input.Coin)
		default:
			var input struct {
				ID    string `json:"id"`
				Event int    `json:"event"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_body", "Некорректный игровой запрос")
				return
			}
			run, err = service.ClaimDinoBoss(r.Context(), id, input.ID, input.Event)
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
				message = "Забег не найден"
			case errors.Is(err, games.ErrEarly):
				status = http.StatusConflict
				message = "Награда ещё не достигнута"
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
