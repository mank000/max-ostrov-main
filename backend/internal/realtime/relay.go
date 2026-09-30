package realtime

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

const channelName = "kutezh_updates"

type relay struct {
	db          *sql.DB
	databaseURL string
	source      string
	logger      *slog.Logger
}

type envelope struct {
	Source    string  `json:"source"`
	Users     []int64 `json:"users,omitempty"`
	Broadcast bool    `json:"broadcast,omitempty"`
	Event     Event   `json:"event"`
}

func NewPostgresBroker(db *sql.DB, databaseURL string, logger *slog.Logger) (*Broker, error) {
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return nil, fmt.Errorf("realtime identity: %w", err)
	}
	b := NewBroker()
	b.relay = &relay{db: db, databaseURL: databaseURL, source: hex.EncodeToString(token), logger: logger}
	return b, nil
}

func (r *relay) send(users []int64, event Event, broadcast bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for {
		size := min(len(users), 64)
		data, err := json.Marshal(envelope{Source: r.source, Users: users[:size], Broadcast: broadcast, Event: event})
		if err != nil || len(data) >= 7900 {
			r.logger.Warn("realtime payload exceeds notification limit", "type", event.Type)
			return
		}
		if _, err := r.db.ExecContext(ctx, `SELECT pg_notify($1, $2)`, channelName, string(data)); err != nil {
			r.logger.Warn("publish realtime notification", "type", event.Type, "error", err)
			return
		}
		users = users[size:]
		if len(users) == 0 {
			return
		}
	}
}

func (b *Broker) Run(ctx context.Context) {
	if b.relay == nil {
		return
	}
	delay := time.Second
	for ctx.Err() == nil {
		started := time.Now()
		err := b.listen(ctx)
		if ctx.Err() != nil {
			return
		}
		b.relay.logger.Warn("realtime listener disconnected", "error", err)
		if time.Since(started) > time.Minute {
			delay = time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		delay = min(delay*2, 30*time.Second)
	}
}

func (b *Broker) listen(ctx context.Context) error {
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	conn, err := pgx.Connect(connectCtx, b.relay.databaseURL)
	cancel()
	if err != nil {
		return err
	}
	defer func() {
		closeCtx, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		_ = conn.Close(closeCtx)
	}()
	setupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	_, err = conn.Exec(setupCtx, `LISTEN `+channelName)
	cancel()
	if err != nil {
		return err
	}
	b.deliver(nil, Event{Type: "sync.required", Payload: json.RawMessage(`{}`), OccurredAt: time.Now().UTC()}, true)
	for {
		notification, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var message envelope
		if len(notification.Payload) >= 8000 || json.Unmarshal([]byte(notification.Payload), &message) != nil ||
			message.Source == b.relay.source || !validEventType(message.Event.Type) {
			continue
		}
		if message.Broadcast && message.Event.Type != "post.created" && message.Event.Type != "sync.required" {
			continue
		}
		b.deliver(message.Users, message.Event, message.Broadcast)
	}
}
