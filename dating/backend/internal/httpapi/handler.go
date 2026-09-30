package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"kutezh/dating/internal/dating"
)

type Handler struct {
	logger      *slog.Logger
	service     *dating.Service
	staticDir   string
	corsOrigin  map[string]struct{}
	resolveUser func(http.ResponseWriter, *http.Request) (int64, bool)
}

func NewHandler(logger *slog.Logger, service *dating.Service, staticDir string, origins []string) http.Handler {
	return newHandler(logger, service, staticDir, origins, nil)
}

func NewAuthenticatedHandler(logger *slog.Logger, service *dating.Service, resolve func(http.ResponseWriter, *http.Request) (int64, bool)) http.Handler {
	return newHandler(logger, service, "", nil, resolve)
}

func newHandler(logger *slog.Logger, service *dating.Service, staticDir string, origins []string, resolve func(http.ResponseWriter, *http.Request) (int64, bool)) http.Handler {
	handler := &Handler{
		resolveUser: resolve,
		logger:      logger,
		service:     service,
		staticDir:   staticDir,
		corsOrigin:  make(map[string]struct{}),
	}
	for _, origin := range origins {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			handler.corsOrigin[origin] = struct{}{}
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handler.health)
	mux.HandleFunc("POST /api/auth", handler.auth)
	mux.HandleFunc("GET /api/me", handler.me)
	mux.HandleFunc("PUT /api/me", handler.saveMe)
	mux.HandleFunc("DELETE /api/me", handler.deleteMe)
	mux.HandleFunc("GET /api/discover", handler.discover)
	mux.HandleFunc("POST /api/swipe", handler.swipe)
	mux.HandleFunc("POST /api/swipe/undo", handler.undo)
	mux.HandleFunc("GET /api/matches", handler.matches)
	mux.HandleFunc("GET /api/stats", handler.stats)
	mux.HandleFunc("DELETE /api/matches/{match_id}", handler.unmatch)
	mux.HandleFunc("GET /api/matches/{match_id}/chat", handler.chat)
	mux.HandleFunc("POST /api/block/{other_id}", handler.block)
	mux.HandleFunc("POST /api/report", handler.report)
	mux.HandleFunc("/", handler.static)

	return handler.withCORS(mux)
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) auth(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	session, err := h.service.Auth(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	profile, err := h.service.Profile(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (h *Handler) saveMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	var input dating.Settings
	if !decodeJSON(w, r, &input) {
		return
	}
	profile, err := h.service.SaveProfile(r.Context(), userID, input)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (h *Handler) deleteMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	if err := h.service.Delete(r.Context(), userID); err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) discover(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	profiles, err := h.service.Discover(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, profiles)
}

func (h *Handler) swipe(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	var input dating.SwipeInput
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := h.service.Swipe(r.Context(), userID, input)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) matches(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	items, err := h.service.Matches(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) stats(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	stats, err := h.service.WeeklyStats(r.Context(), userID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (h *Handler) unmatch(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	if err := h.service.Unmatch(r.Context(), userID, parseID(r.PathValue("match_id"))); err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) chat(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	matchID := parseID(r.PathValue("match_id"))
	if matchID <= 0 {
		writeDetail(w, http.StatusBadRequest, "Некорректный мэтч")
		return
	}
	target, err := h.service.Chat(r.Context(), userID, matchID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, target)
}

func (h *Handler) block(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	otherID := parseID(r.PathValue("other_id"))
	if err := h.service.Block(r.Context(), userID, otherID); err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) report(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	var input dating.ReportInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.service.Report(r.Context(), userID, input); err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) userID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	if h.resolveUser != nil {
		return h.resolveUser(w, r)
	}
	writeDetail(w, http.StatusUnauthorized, "Открой приложение в MAX")
	return 0, false
}

func (h *Handler) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeDetail(w, http.StatusNotFound, "Не найдено")
		return
	}
	path := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if path == "." || path == "" {
		path = "index.html"
	}
	full := filepath.Join(h.staticDir, path)
	if !within(h.staticDir, full) {
		writeDetail(w, http.StatusNotFound, "Не найдено")
		return
	}
	info, err := os.Stat(full)
	if err == nil && !info.IsDir() {
		http.ServeFile(w, r, full)
		return
	}
	index := filepath.Join(h.staticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		writeDetail(w, http.StatusServiceUnavailable, "Frontend ещё не собран")
		return
	}
	http.ServeFile(w, r, index)
}

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	status, detail := dating.StatusError(err)
	if status >= 500 {
		h.logger.Error("dating request failed", "error", err)
	}
	writeDetail(w, status, detail)
}

func (h *Handler) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := h.corsOrigin[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Kutezh-Session, X-User-Id")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	reader := io.LimitReader(r.Body, 1<<20)
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeDetail(w, http.StatusBadRequest, "Некорректный JSON")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeDetail(w, http.StatusBadRequest, "Некорректный JSON")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeDetail(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]string{"detail": detail})
}

func parseID(value string) int64 {
	id, _ := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return id
}

func within(root, path string) bool {
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	pathAbs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(rootAbs, pathAbs)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (h *Handler) undo(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	var input dating.SwipeInput
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := h.service.Undo(r.Context(), userID, input.UserID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
