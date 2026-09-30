package httpapi

import (
	"errors"
	"net/http"

	"kutezh/backend/internal/games"
	"kutezh/backend/internal/maxauth"
)

func handleLifeGame(auth *maxauth.Service, service *games.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}

		var (
			view games.LifeView
			err  error
		)
		if r.Method == http.MethodGet {
			view, err = service.Life(r.Context(), userID)
		} else {
			var input struct {
				Action string `json:"action"`
				Target string `json:"target"`
				Key    string `json:"request_key"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_body", "Некорректное действие")
				return
			}
			view, err = service.LifeAction(r.Context(), userID, input.Action, input.Target, input.Key)
		}

		if err != nil {
			status := http.StatusInternalServerError
			message := "Не удалось сохранить жизнь. Повторите попытку"
			switch {
			case errors.Is(err, games.ErrInput):
				status = http.StatusBadRequest
				message = "Некорректное действие"
			case errors.Is(err, games.ErrLifeBusy):
				status = http.StatusConflict
				message = "Такой фоновый проект уже идёт или заняты все три фоновых слота"
			case errors.Is(err, games.ErrLifeLocked):
				status = http.StatusConflict
				message = "Это действие пока недоступно"
			case errors.Is(err, games.ErrLifeFunds):
				status = http.StatusConflict
				message = "Недостаточно денег"
			case errors.Is(err, games.ErrLifeNeeds):
				status = http.StatusConflict
				message = "Сначала восстановите сытость, энергию или здоровье"
			case errors.Is(err, games.ErrLifeEvent):
				status = http.StatusConflict
				message = "Сначала примите решение по текущему событию"
			case errors.Is(err, games.ErrLifeCooldown):
				status = http.StatusTooManyRequests
				message = "Эта помощь недавно уже использовалась"
			}
			writeError(w, status, "life_game_error", message)
			return
		}
		writeJSON(w, http.StatusOK, view)
	}
}
