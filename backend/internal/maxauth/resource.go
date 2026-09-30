package maxauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
)

type ResourceScope byte

const (
	MediaRead           ResourceScope = 1
	RealtimeRead        ResourceScope = 2
	resourcePayloadSize               = 42
)

func (s *Service) CreateResourceToken(token string, scope ResourceScope) (string, error) {
	if len(s.resourceKey) == 0 {
		return "", ErrUnavailable
	}
	if scope != MediaRead && scope != RealtimeRead {
		return "", ErrInvalidSession
	}
	session, err := s.Session(token)
	if err != nil {
		return "", err
	}
	payload := make([]byte, resourcePayloadSize)
	payload[0], payload[1] = 1, byte(scope)
	binary.BigEndian.PutUint64(payload[2:10], uint64(session.ExpiresAt.Unix()))
	key := sha256.Sum256([]byte(token))
	copy(payload[10:], key[:])
	return base64.RawURLEncoding.EncodeToString(append(payload, s.signResource(payload)...)), nil
}

// Подписи недостаточно: ниже проверяем живую сессию, чтобы выход отзывал и ссылки на медиа.
func (s *Service) ResourceSession(token string, scope ResourceScope) (Session, error) {
	if len(s.resourceKey) == 0 {
		return Session{}, ErrUnavailable
	}
	if (scope != MediaRead && scope != RealtimeRead) || len(token) != 99 {
		return Session{}, ErrInvalidSession
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(data) != resourcePayloadSize+sha256.Size {
		return Session{}, ErrInvalidSession
	}
	payload := data[:resourcePayloadSize]
	if payload[0] != 1 || payload[1] != byte(scope) ||
		!hmac.Equal(data[resourcePayloadSize:], s.signResource(payload)) ||
		int64(binary.BigEndian.Uint64(payload[2:10])) <= s.now().Unix() {
		return Session{}, ErrInvalidSession
	}
	var key [sha256.Size]byte
	copy(key[:], payload[10:])
	return s.sessionByKey(key)
}

func (s *Service) signResource(payload []byte) []byte {
	mac := hmac.New(sha256.New, s.resourceKey)
	_, _ = mac.Write([]byte("kutezh:read-resource:v1\x00"))
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}
