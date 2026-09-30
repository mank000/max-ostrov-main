package httpapi

import (
	"kutezh/backend/internal/maxauth"
	"kutezh/backend/internal/moderation"
	"net/http"
	"strings"
)

func handleAdmin(auth *maxauth.Service, service *moderation.Service, mediaService mediaService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUserID(w, r, auth)
		if !ok {
			return
		}
		principal, err := service.PrincipalForUser(r.Context(), userID)
		if writeModerationError(w, err) {
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/")
		if path == "session" {
			if !allowMethods(w, r, http.MethodGet) {
				return
			}
			writeJSON(w, http.StatusOK, principal)
			return
		}
		if path == "support" || strings.HasPrefix(path, "support/") {
			handleModerationSupport(w, r, service, mediaService, principal, path)
			return
		}
		if !handleAdminManagement(w, r, service, principal, path) {
			handleNotFound(w, r)
		}
	}
}

// Shared by the mini-app's authenticated session and the moderation site's OTP session.
func handleAdminManagement(w http.ResponseWriter, r *http.Request, service *moderation.Service, principal moderation.Principal, path string) bool {
	switch path {
	case "users", "content", "actions", "audit":
	default:
		return false
	}
	if principal.Role != "administrator" {
		writeError(w, http.StatusForbidden, "administrator_required", "Требуется роль администратора")
		return true
	}
	switch path {
	case "actions":
		if !allowMethods(w, r, http.MethodPost) {
			return true
		}
		var input moderation.DirectAction
		if decodeJSON(w, r, &input) != nil {
			writeError(w, http.StatusBadRequest, "invalid_action", "Проверьте действие")
			return true
		}
		if writeModerationError(w, service.Manage(r.Context(), principal.UserID, input)) {
			return true
		}
		w.WriteHeader(http.StatusNoContent)
	case "users", "content":
		if !allowMethods(w, r, http.MethodGet) {
			return true
		}
		before, limit, ok := moderationPage(w, r, "q", "status", "target_type")
		if !ok {
			return true
		}
		status := r.URL.Query().Get("status")
		if status == "" {
			status = "all"
		}
		query := r.URL.Query().Get("q")
		if path == "users" {
			items, cursor, err := service.ListUsers(r.Context(), query, status, before, limit)
			if writeModerationError(w, err) {
				return true
			}
			writeJSON(w, http.StatusOK, map[string]any{"users": items, "next_cursor": cursor})
		} else {
			items, cursor, err := service.ListContent(r.Context(), moderation.TargetType(r.URL.Query().Get("target_type")), query, status, before, limit)
			if writeModerationError(w, err) {
				return true
			}
			writeJSON(w, http.StatusOK, map[string]any{"content": items, "next_cursor": cursor})
		}
	case "audit":
		if !allowMethods(w, r, http.MethodGet) {
			return true
		}
		before, limit, ok := moderationPage(w, r)
		if !ok {
			return true
		}
		items, cursor, err := service.ListActions(r.Context(), before, limit)
		if writeModerationError(w, err) {
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"actions": items, "next_cursor": cursor})
	}
	return true
}
