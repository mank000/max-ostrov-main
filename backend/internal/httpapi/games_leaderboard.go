package httpapi

import (
	"errors"
	"net/http"

	"kutezh/backend/internal/games"
	"kutezh/backend/internal/maxauth"
)

func handleGameLeaderboard(auth *maxauth.Service, service *games.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}

		if r.Method == http.MethodGet {
			result, err := service.Leaderboards(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, "game_leaderboard_error", "Не удалось загрузить таблицу лидеров")
				return
			}
			writeJSON(w, http.StatusOK, result)
			return
		}

		var input struct {
			Kind   string `json:"kind"`
			RunID  string `json:"run_id"`
			Value  int64  `json:"value"`
			Detail int64  `json:"detail"`
		}
		if decodeJSON(w, r, &input) != nil {
			writeError(w, http.StatusBadRequest, "invalid_body", "Некорректный результат игры")
			return
		}
		if err := service.RecordScore(r.Context(), userID, input.Kind, input.RunID, input.Value, input.Detail); err != nil {
			status := http.StatusInternalServerError
			message := "Не удалось сохранить результат"
			switch {
			case errors.Is(err, games.ErrInput):
				status = http.StatusBadRequest
				message = "Некорректный результат игры"
			case errors.Is(err, games.ErrMissing):
				status = http.StatusNotFound
				message = "Игровой раунд не найден"
			}
			writeError(w, status, "game_score_error", message)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
