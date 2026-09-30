package httpapi

import (
	"errors"
	"net/http"

	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/rewards"
)

type transactionsResponse struct {
	Transactions []rewards.Transaction `json:"transactions"`
	NextCursor   *int64                `json:"next_cursor,omitempty"`
}

type giftsResponse struct {
	Gifts      []rewards.Gift `json:"gifts"`
	NextCursor *int64         `json:"next_cursor,omitempty"`
}

func handleWallet(auth *maxauth.Service, service rewardService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		wallet, err := service.Wallet(r.Context(), userID)
		if writeRewardError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, wallet)
	}
}
func handleTransactions(auth *maxauth.Service, service rewardService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		before, valid := parseCursor(r)
		if !valid {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор операций")
			return
		}
		items, err := service.Transactions(r.Context(), userID, before)
		if writeRewardError(w, err) {
			return
		}
		var next *int64
		if len(items) == 50 {
			value := items[len(items)-1].ID
			next = &value
		}
		writeJSON(w, http.StatusOK, transactionsResponse{Transactions: items, NextCursor: next})
	}
}
func handleAchievements(auth *maxauth.Service, service rewardService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		items, err := service.Achievements(r.Context(), userID)
		if writeRewardError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"achievements": items})
	}
}
func handleGifts(auth *maxauth.Service, service rewardService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		before, valid := parseCursor(r)
		if !valid {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "Некорректный курсор подарков")
			return
		}
		items, err := service.Gifts(r.Context(), userID, before)
		if writeRewardError(w, err) {
			return
		}
		var next *int64
		if len(items) == 50 {
			value := items[len(items)-1].ID
			next = &value
		}
		writeJSON(w, http.StatusOK, giftsResponse{Gifts: items, NextCursor: next})
	}
}
func handleStoreItems(auth *maxauth.Service, service rewardService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := authenticatedUserID(w, r, auth); !ok {
			return
		}
		items, err := service.Items(r.Context())
		if writeRewardError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}
func handleStorePurchase(auth *maxauth.Service, service rewardService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		var input rewards.PurchaseInput
		if decodeJSON(w, r, &input) != nil {
			writeError(w, http.StatusBadRequest, "invalid_purchase", "Проверьте данные покупки")
			return
		}
		purchase, err := service.Purchase(r.Context(), userID, input)
		if writeRewardError(w, err) {
			return
		}
		writeJSON(w, http.StatusCreated, purchase)
	}
}
func handleDecoration(auth *maxauth.Service, service rewardService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowMethods(w, r, http.MethodPut, http.MethodDelete) {
			return
		}
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		code := ""
		if r.Method == http.MethodPut {
			var input struct {
				ItemCode string `json:"item_code"`
			}
			if decodeJSON(w, r, &input) != nil {
				writeError(w, http.StatusBadRequest, "invalid_decoration", "Выберите оформление профиля")
				return
			}
			code = input.ItemCode
		}
		if writeRewardError(w, service.SetDecoration(r.Context(), userID, code)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
func writeRewardError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, rewards.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "invalid_request", "Проверьте данные запроса")
	case errors.Is(err, rewards.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Объект не найден")
	case errors.Is(err, rewards.ErrAlreadyOwned):
		writeError(w, http.StatusConflict, "decoration_already_owned", "Это украшение уже есть у вас")
	case errors.Is(err, rewards.ErrInsufficientBalance):
		writeError(w, http.StatusConflict, "insufficient_coins", "Недостаточно монет")
	case errors.Is(err, rewards.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden", "Действие недоступно")
	case errors.Is(err, rewards.ErrNotFriends):
		writeError(w, http.StatusForbidden, "friendship_required", "Отправлять подарки можно только друзьям")
	case errors.Is(err, rewards.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "idempotency_conflict", "Ключ повтора уже использован для другой операции")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "Не удалось выполнить операцию")
	}
	return true
}
