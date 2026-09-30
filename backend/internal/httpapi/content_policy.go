package httpapi

import (
	"errors"
	"net/http"

	"kutezh/backend/internal/contentpolicy"
)

func writeContentPolicyError(w http.ResponseWriter, err error) bool {
	if errors.Is(err, contentpolicy.ErrAnalysisUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "content_analysis_unavailable", "Проверка текста временно недоступна. Попробуйте ещё раз.")
		return true
	}
	var violation *contentpolicy.Violation
	if !errors.As(err, &violation) {
		return false
	}
	writeError(w, http.StatusUnprocessableEntity, "content_policy", violation.UserMessage())
	return true
}
