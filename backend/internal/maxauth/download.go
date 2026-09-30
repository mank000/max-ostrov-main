package maxauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"time"
)

const downloadPayloadSize = 49

func (s *Service) CreateDownloadToken(token string, mediaID int64) (string, time.Time, error) {
	if len(s.resourceKey) == 0 {
		return "", time.Time{}, ErrUnavailable
	}
	if mediaID <= 0 {
		return "", time.Time{}, ErrInvalidSession
	}
	session, err := s.Session(token)
	if err != nil {
		return "", time.Time{}, err
	}
	expires := s.now().Add(5 * time.Minute)
	if session.ExpiresAt.Before(expires) {
		expires = session.ExpiresAt
	}
	expires = expires.Truncate(time.Second)
	payload := make([]byte, downloadPayloadSize)
	payload[0] = 1
	binary.BigEndian.PutUint64(payload[1:9], uint64(mediaID))
	binary.BigEndian.PutUint64(payload[9:17], uint64(expires.Unix()))
	key := sha256.Sum256([]byte(token))
	copy(payload[17:], key[:])
	signature := s.signDownload(payload)
	return base64.RawURLEncoding.EncodeToString(append(payload, signature...)), expires, nil
}

func (s *Service) DownloadUser(token string, mediaID int64) (int64, error) {
	if len(s.resourceKey) == 0 {
		return 0, ErrUnavailable
	}
	if mediaID <= 0 || len(token) != 108 {
		return 0, ErrInvalidSession
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || len(data) != downloadPayloadSize+sha256.Size || data[0] != 1 {
		return 0, ErrInvalidSession
	}
	payload := data[:downloadPayloadSize]
	if !hmac.Equal(data[downloadPayloadSize:], s.signDownload(payload)) ||
		binary.BigEndian.Uint64(payload[1:9]) != uint64(mediaID) ||
		int64(binary.BigEndian.Uint64(payload[9:17])) <= s.now().Unix() {
		return 0, ErrInvalidSession
	}
	var key [sha256.Size]byte
	copy(key[:], payload[17:])
	session, err := s.sessionByKey(key)
	if err != nil {
		return 0, err
	}
	return session.User.ID, nil
}

func (s *Service) signDownload(payload []byte) []byte {
	mac := hmac.New(sha256.New, s.resourceKey)
	_, _ = mac.Write([]byte("kutezh:media-download:v1\x00"))
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}
