package realtime

import (
	"encoding/json"
	"sync"
	"time"
)

type Event struct {
	Type       string          `json:"type"`
	Payload    json.RawMessage `json:"payload"`
	OccurredAt time.Time       `json:"occurred_at"`
}

type Broker struct {
	mu          sync.RWMutex
	nextID      uint64
	subscribers map[int64]map[uint64]chan Event
	relay       *relay
}

func NewBroker() *Broker {
	return &Broker{subscribers: make(map[int64]map[uint64]chan Event)}
}

func (b *Broker) Subscribe(userID int64) (<-chan Event, func()) {
	b.mu.Lock()
	b.nextID++
	id := b.nextID
	channel := make(chan Event, 32)
	if b.subscribers[userID] == nil {
		b.subscribers[userID] = make(map[uint64]chan Event)
	}
	if len(b.subscribers[userID]) >= 8 {
		oldest := id
		for candidate := range b.subscribers[userID] {
			if candidate < oldest {
				oldest = candidate
			}
		}
		close(b.subscribers[userID][oldest])
		delete(b.subscribers[userID], oldest)
	}
	b.subscribers[userID][id] = channel
	b.mu.Unlock()

	var once sync.Once
	cancel := func() {
		once.Do(func() {
			b.mu.Lock()
			if _, exists := b.subscribers[userID][id]; exists {
				delete(b.subscribers[userID], id)
				close(channel)
			}
			if len(b.subscribers[userID]) == 0 {
				delete(b.subscribers, userID)
			}
			b.mu.Unlock()
		})
	}
	return channel, cancel
}

func (b *Broker) Publish(userID int64, eventType string, payload any) {
	b.PublishMany([]int64{userID}, eventType, payload)
}

func (b *Broker) PublishMany(userIDs []int64, eventType string, payload any) {
	if len(userIDs) == 0 || !validEventType(eventType) {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	event := Event{Type: eventType, Payload: data, OccurredAt: time.Now().UTC()}
	b.deliver(userIDs, event, false)
	if b.relay != nil {
		b.relay.send(userIDs, event, false)
	}
}

func (b *Broker) Broadcast(eventType string) {
	if !validEventType(eventType) {
		return
	}
	event := Event{Type: eventType, Payload: json.RawMessage(`{}`), OccurredAt: time.Now().UTC()}
	b.deliver(nil, event, true)
	if b.relay != nil {
		b.relay.send(nil, event, true)
	}
}

func (b *Broker) deliver(userIDs []int64, event Event, broadcast bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if broadcast {
		for userID := range b.subscribers {
			b.deliverLocked(userID, event)
		}
		return
	}
	for _, userID := range userIDs {
		b.deliverLocked(userID, event)
	}
}

func (b *Broker) deliverLocked(userID int64, event Event) {
	for id, channel := range b.subscribers[userID] {
		select {
		case channel <- event:
		default:
			close(channel)
			delete(b.subscribers[userID], id)
		}
	}
	if len(b.subscribers[userID]) == 0 {
		delete(b.subscribers, userID)
	}
}

func validEventType(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if character != '.' && character != '_' && character != '-' &&
			(character < 'a' || character > 'z') && (character < '0' || character > '9') {
			return false
		}
	}
	return true
}

func (b *Broker) Users() []int64 {
	b.mu.RLock()
	defer b.mu.RUnlock()
	ids := make([]int64, 0, len(b.subscribers))
	for id := range b.subscribers {
		ids = append(ids, id)
	}
	return ids
}
