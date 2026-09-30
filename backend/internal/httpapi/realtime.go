package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"kutezh/backend/internal/maxauth"
)

func handleRealtime(authService *maxauth.Service, service realtimeService, shutdown <-chan struct{}) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := readResourceSession(r, authService, maxauth.RealtimeRead)
		if err != nil {
			writeSessionError(w, err)
			return
		}
		events, cancel := service.Subscribe(session.User.ID)
		defer cancel()
		controller := http.NewResponseController(w)
		defer func() { _ = controller.SetWriteDeadline(time.Time{}) }()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Accel-Buffering", "no")
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := fmt.Fprint(w, "event: ready\ndata: {}\n\n"); err != nil {
			return
		}
		if err := controller.Flush(); err != nil {
			return
		}
		expiry := time.NewTimer(time.Until(session.ExpiresAt))
		defer expiry.Stop()
		heartbeat := time.NewTicker(15 * time.Second)
		defer heartbeat.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-shutdown:
				return
			case <-expiry.C:
				return
			case event, open := <-events:
				if !open {
					return
				}
				data, err := json.Marshal(event)
				if err != nil {
					continue
				}
				_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))

				if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, data); err != nil {
					return
				}
				if err := controller.Flush(); err != nil {
					return
				}
			case <-heartbeat.C:
				if _, err := readResourceSession(r, authService, maxauth.RealtimeRead); err != nil {
					return
				}
				_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if _, err := fmt.Fprint(w, ": keep-alive\n\n"); err != nil {
					return
				}
				if err := controller.Flush(); err != nil {
					return
				}
			}
		}
	}
}
