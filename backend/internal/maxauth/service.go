package maxauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"
)

var (
	ErrUnavailable     = errors.New("MAX authentication is not configured")
	ErrInvalidInitData = errors.New("invalid MAX initialization data")
	ErrExpiredInitData = errors.New("expired MAX initialization data")
	ErrInvalidSession  = errors.New("invalid session")
	ErrSuspended       = errors.New("account suspended")
)

type SessionStore interface {
	Save([sha256.Size]byte, Session, time.Time) error
	Load([sha256.Size]byte, time.Time) (Session, error)
	Delete([sha256.Size]byte) error
	Prune(time.Time) error
}

type Config struct {
	ResourceKey []byte
	BotToken    string
	MaxAge      time.Duration
	TTL         time.Duration
	Store       SessionStore
}

type User struct {
	ProviderUserID int64  `json:"-"`
	StartParam     string `json:"-"`
	ID             int64  `json:"id"`
	Username       string `json:"username,omitempty"`
	FirstName      string `json:"first_name"`
	LastName       string `json:"last_name,omitempty"`
	LanguageCode   string `json:"language_code,omitempty"`
	PhotoURL       string `json:"photo_url,omitempty"`
}

type Session struct {
	User      User      `json:"user"`
	ExpiresAt time.Time `json:"expires_at"`
}

type Service struct {
	resourceKey []byte
	botToken    string
	maxAge      time.Duration
	ttl         time.Duration
	now         func() time.Time
	random      io.Reader
	store       SessionStore

	mu          sync.Mutex
	sessions    map[[sha256.Size]byte]Session
	nextCleanup time.Time

	botInfoMu   sync.Mutex
	botUsername string
}

func NewService(config Config) *Service {
	key := append([]byte(nil), config.ResourceKey...)
	if len(key) == 0 {
		key = []byte(config.BotToken)
	}
	return &Service{
		resourceKey: key,
		botToken:    config.BotToken,
		maxAge:      config.MaxAge,
		ttl:         config.TTL,
		now:         time.Now,
		random:      rand.Reader,
		store:       config.Store,
		sessions:    make(map[[sha256.Size]byte]Session),
	}
}

func (s *Service) CreateSession(user User) (string, Session, error) {
	if user.ID <= 0 {
		return "", Session{}, ErrInvalidSession
	}
	return s.createSession(user, s.now())
}

func (s *Service) createSession(user User, now time.Time) (string, Session, error) {
	tokenBytes := make([]byte, 32)
	if _, err := io.ReadFull(s.random, tokenBytes); err != nil {
		return "", Session{}, fmt.Errorf("generate session token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	session := Session{
		User:      user,
		ExpiresAt: now.Add(s.ttl),
	}

	key := sha256.Sum256([]byte(token))
	if s.store != nil {
		if err := s.store.Save(key, session, now); err != nil {
			return "", Session{}, fmt.Errorf("persist session: %w", err)
		}
		return token, session, nil
	}

	s.mu.Lock()
	if !now.Before(s.nextCleanup) {
		for key, stored := range s.sessions {
			if !now.Before(stored.ExpiresAt) {
				delete(s.sessions, key)
			}
		}
		s.nextCleanup = now.Add(time.Minute)
	}
	s.sessions[key] = session
	s.mu.Unlock()

	return token, session, nil
}

func (s *Service) Session(token string) (Session, error) {
	if len(token) != 43 {
		return Session{}, ErrInvalidSession
	}
	if decoded, err := base64.RawURLEncoding.Strict().DecodeString(token); err != nil || len(decoded) != 32 {
		return Session{}, ErrInvalidSession
	}

	return s.sessionByKey(sha256.Sum256([]byte(token)))
}

func (s *Service) sessionByKey(key [sha256.Size]byte) (Session, error) {
	if s.store != nil {
		return s.store.Load(key, s.now())
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	session, ok := s.sessions[key]
	if !ok {
		return Session{}, ErrInvalidSession
	}
	if !s.now().Before(session.ExpiresAt) {
		delete(s.sessions, key)
		return Session{}, ErrInvalidSession
	}

	return session, nil
}

func (s *Service) Logout(token string) error {
	if token == "" {
		return nil
	}

	key := sha256.Sum256([]byte(token))
	if s.store != nil {
		if err := s.store.Delete(key); err != nil {
			return fmt.Errorf("delete session: %w", err)
		}
		return nil
	}

	s.mu.Lock()
	delete(s.sessions, key)
	s.mu.Unlock()
	return nil
}

func (s *Service) resumeSession(providerUserID int64, token string) (Session, error) {
	session, err := s.Session(token)
	if err != nil {
		return Session{}, err
	}
	if providerUserID <= 0 || session.User.ProviderUserID != providerUserID {
		return Session{}, ErrInvalidSession
	}
	return session, nil
}
